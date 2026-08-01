import { readFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { type InstallRecord, ManifestSchema } from "@ryuujs/core";
import * as generators from "@ryuujs/generators";
import { Schema } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	applyInstalledPlan,
	configuredPackageManager,
	hasProjectDevDependency,
	loadManagedProject,
	loadProjectRegistry,
	runPackageManagerOperation,
} from "../src/commands/lifecycle";
import { withTempDir, writeJson } from "./lifecycle-fixtures";

const promptMocks = vi.hoisted(() => ({
	logError: vi.fn(),
}));

vi.mock("@clack/prompts", () => ({
	log: { error: promptMocks.logError },
}));

const decodeManifest = Schema.decodeUnknownSync(ManifestSchema);

const tailwindInstall: InstallRecord = {
	definitionId: "tailwind",
	targets: [{ kind: "project" }],
};

const commandVersions = { node: "22.11.0", pnpm: "10.12.1" };

async function readJson(path: string): Promise<unknown> {
	return JSON.parse(await readFile(path, "utf-8"));
}

function scaffoldWebModule(directory: string) {
	return writeJson(join(directory, "apps/web/forge.json"), {
		framework: "nextjs",
		id: "abcde",
		slots: { api: "app/api", layout: "app/layout.tsx", page: "app/page.tsx" },
		template: { id: "nextjs/base", version: 1 },
		type: "app",
	});
}

describe("lifecycle", () => {
	beforeEach(() => {
		promptMocks.logError.mockReset();
	});

	it("applies an installed plan and records the install in the manifest", async () => {
		await withTempDir("lifecycle-apply", async (directory) => {
			await scaffoldWebModule(directory);

			await applyInstalledPlan(
				directory,
				{ slug: "acme", web: "nextjs" },
				[tailwindInstall],
				commandVersions,
			);

			const manifest = decodeManifest(
				await readJson(join(directory, ".forge/manifest.json")),
			);
			expect(manifest.config).toEqual({ slug: "acme", web: "nextjs" });
			expect(manifest.installs).toEqual([
				tailwindInstall,
				{
					definitionId: "ui",
					targets: [{ kind: "module", moduleId: "abcde" }],
				},
			]);

			expect(
				await readJson(join(directory, "packages/ui/forge.json")),
			).toMatchObject({
				capabilities: expect.arrayContaining(["tailwind"]),
				template: { id: "ui", version: 1 },
				type: "package",
			});

			await expect(
				readFile(join(directory, "apps/web/app/layout.tsx"), "utf-8"),
			).resolves.toContain('import "@acme/ui/globals.css";');
			await expect(
				readFile(
					join(directory, "packages/ui/src/styles/globals.css"),
					"utf-8",
				),
			).resolves.toContain('@import "tailwindcss";');
			await expect(
				readJson(join(directory, ".forge/lock.json")),
			).resolves.toMatchObject({ artifacts: expect.any(Object) });
		});
	});

	it("detects project devDependencies without treating dependencies as devDependencies", async () => {
		await withTempDir("lifecycle-dev-dependency", async (directory) => {
			await writeJson(join(directory, "package.json"), {
				dependencies: { "@acme/runtime": "1.0.0" },
				devDependencies: { "@acme/forge-sentry": "1.2.3" },
			});

			await expect(
				hasProjectDevDependency(directory, "@acme/forge-sentry"),
			).resolves.toBe(true);
			await expect(
				hasProjectDevDependency(directory, "@acme/runtime"),
			).resolves.toBe(false);
		});
	});

	it("falls back to pnpm for legacy package-manager metadata", () => {
		expect(configuredPackageManager({ packageManager: "volt" })).toBe("pnpm");
	});

	it("runs package-manager operations in the project root", async () => {
		await withTempDir("lifecycle-pm-operation", async (directory) => {
			await expect(
				runPackageManagerOperation(directory, {
					args: [],
					command: "/usr/bin/true",
				}),
			).resolves.toBe(true);
			await expect(
				runPackageManagerOperation(directory, {
					args: [],
					command: "/usr/bin/false",
				}),
			).resolves.toBe(false);
		});
	});

	it("soft-fails when the package-manager command cannot be spawned", async () => {
		await withTempDir("lifecycle-pm-missing", async (directory) => {
			await expect(
				runPackageManagerOperation(directory, {
					args: [],
					command: "forge-test-nonexistent-package-manager-xyz",
				}),
			).resolves.toBe(false);
		});
	});

	it("loads a project's merged registry through the shared lifecycle path", async () => {
		const loaded = await loadProjectRegistry("/fixture-project", []);
		expect(loaded.descriptors).toEqual([]);
		expect(loaded.registry.addons.map((entry) => entry.id)).toContain(
			"tailwind",
		);
	});

	it("round-trips the manifest config instead of inferring it", async () => {
		await withTempDir("lifecycle-roundtrip", async (directory) => {
			await scaffoldWebModule(directory);
			await applyInstalledPlan(
				directory,
				{ slug: "acme", web: "nextjs" },
				[tailwindInstall],
				commandVersions,
			);

			const project = await loadManagedProject(directory, "add");

			expect(project.projectRoot).toBe(directory);
			expect(project.config).toStrictEqual({ slug: "acme", web: "nextjs" });
			expect(project.manifest.installs).toEqual([
				tailwindInstall,
				{
					definitionId: "ui",
					targets: [{ kind: "module", moduleId: "abcde" }],
				},
			]);
			expect(project.modules.map((module) => module.root)).toEqual(
				expect.arrayContaining(["apps/web", "packages/ui"]),
			);
		});
	});

	it("normalizes a relative project root before loading the project", async () => {
		await withTempDir("lifecycle-relative-root", async (directory) => {
			await writeJson(join(directory, ".forge/manifest.json"), {
				config: { slug: "acme" },
				installs: [],
				modules: {},
				schemaVersion: 1,
			});

			const previousCwd = process.cwd();
			process.chdir(directory);

			try {
				const project = await loadManagedProject(".", "add");

				expect(project.projectRoot).toBe(resolve("."));
				expect(isAbsolute(project.projectRoot)).toBe(true);
			} finally {
				process.chdir(previousCwd);
			}
		});
	});

	it("exits when the manifest config is empty", async () => {
		const exit = vi
			.spyOn(process, "exit")
			.mockImplementation((code?: string | number | null): never => {
				throw new Error(`exit:${code ?? 0}`);
			});

		try {
			await withTempDir("lifecycle-legacy", async (directory) => {
				await writeJson(join(directory, ".forge/manifest.json"), {
					config: {},
					installs: [
						{ definitionId: "drizzle", targets: [{ kind: "project" }] },
					],
					modules: {
						ddddd: { definitionIds: ["drizzle"], root: "packages/db" },
					},
					schemaVersion: 1,
				});

				await expect(loadManagedProject(directory, "add")).rejects.toThrow(
					"exit:1",
				);
				expect(promptMocks.logError).toHaveBeenCalledWith(
					"We couldn't find a Forge project here. The .forge directory is missing or incomplete.",
				);
			});
		} finally {
			exit.mockRestore();
		}
	});

	it("exits when the directory is not a managed project", async () => {
		const exit = vi.spyOn(process, "exit").mockImplementation(((
			code?: string | number | null,
		) => {
			throw new Error(`exit:${code ?? 0}`);
		}) as never);

		try {
			await withTempDir("lifecycle-unmanaged", async (directory) => {
				await expect(loadManagedProject(directory, "update")).rejects.toThrow(
					"exit:1",
				);
			});

			expect(promptMocks.logError).toHaveBeenCalledWith(
				"We couldn't find a Forge project here. The .forge directory is missing or incomplete.",
			);
		} finally {
			exit.mockRestore();
		}
	});

	it("formats lifecycle failures as a single sentence", async () => {
		const exit = vi.spyOn(process, "exit").mockImplementation(((
			code?: string | number | null,
		) => {
			throw new Error(`exit:${code ?? 0}`);
		}) as never);

		try {
			await withTempDir("lifecycle-failure", async (directory) => {
				await expect(
					applyInstalledPlan(
						directory,
						{ slug: "acme" },
						[
							{
								definitionId: "missing",
								targets: [{ kind: "project" }],
							},
						],
						commandVersions,
					),
				).rejects.toThrow("exit:1");
			});

			expect(promptMocks.logError).toHaveBeenCalledWith(
				"We couldn't plan this change. Definition Missing.",
			);
		} finally {
			exit.mockRestore();
		}
	});

	it("formats registry loading failures without a stack trace", async () => {
		const exit = vi
			.spyOn(process, "exit")
			.mockImplementation((code?: string | number | null): never => {
				throw new Error(`exit:${code ?? 0}`);
			});

		try {
			await withTempDir("lifecycle-registry-failure", async (directory) => {
				await expect(
					applyInstalledPlan(directory, { slug: "acme" }, [], commandVersions, [
						"@fixture/missing-registry",
					]),
				).rejects.toThrow("exit:1");
			});

			expect(promptMocks.logError).toHaveBeenCalledWith(
				"Registry Not Installed: @fixture/missing-registry",
			);
			expect(promptMocks.logError.mock.calls.flat().join("\n")).not.toContain(
				"RegistryLoadError",
			);
		} finally {
			exit.mockRestore();
		}
	});

	it("rethrows non-registry loading failures", async () => {
		const defect = new Error("unexpected loader defect");
		vi.spyOn(generators, "loadDefinitionRegistry").mockImplementationOnce(
			(): never => {
				throw defect;
			},
		);

		await expect(
			applyInstalledPlan(
				"/fixture-project",
				{ slug: "acme" },
				[],
				commandVersions,
			),
		).rejects.toBe(defect);
		expect(promptMocks.logError).not.toHaveBeenCalled();
	});
});
