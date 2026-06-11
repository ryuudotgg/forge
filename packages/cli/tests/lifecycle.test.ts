import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { type InstallRecord, ManifestSchema } from "@ryuujs/core";
import { Schema } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	applyInstalledPlan,
	loadManagedProject,
} from "../src/commands/lifecycle";
import { withTempDir, writeJson, writeText } from "./lifecycle-fixtures";

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

async function readJson(path: string): Promise<unknown> {
	return JSON.parse(await readFile(path, "utf-8"));
}

function scaffoldWebModule(directory: string) {
	return writeJson(join(directory, "apps/web/forge.json"), {
		framework: "nextjs",
		id: "abcde",
		slots: { api: "app/api", layout: "app/layout.tsx", page: "app/page.tsx" },
		template: { id: "base", version: 1 },
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

			await applyInstalledPlan(directory, { slug: "acme", web: "nextjs" }, [
				tailwindInstall,
			]);

			const manifest = decodeManifest(
				await readJson(join(directory, ".forge/manifest.json")),
			);
			expect(manifest.config).toEqual({ slug: "acme", web: "nextjs" });
			expect(manifest.installs).toEqual([tailwindInstall]);

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

	it("round-trips the manifest config instead of inferring it", async () => {
		await withTempDir("lifecycle-roundtrip", async (directory) => {
			await scaffoldWebModule(directory);
			await applyInstalledPlan(directory, { slug: "acme", web: "nextjs" }, [
				tailwindInstall,
			]);

			const project = await loadManagedProject(directory, "add");

			expect(project.projectRoot).toBe(directory);
			expect(project.config).toStrictEqual({ slug: "acme", web: "nextjs" });
			expect(project.manifest.installs).toEqual([tailwindInstall]);
			expect(project.modules.map((module) => module.root)).toEqual(
				expect.arrayContaining(["apps/web", "packages/ui"]),
			);
		});
	});

	it("infers the config snapshot when the manifest config is empty", async () => {
		await withTempDir("lifecycle-legacy", async (directory) => {
			await writeJson(join(directory, "package.json"), {
				engines: { bun: "1.2.19" },
				name: "acme",
				packageManager: "yarn@4.1.0",
			});
			await writeText(join(directory, "biome.json"), "{}\n");
			await writeText(join(directory, "lefthook.yml"), "pre-commit:\n");
			await writeJson(join(directory, ".forge/manifest.json"), {
				config: {},
				installs: [{ definitionId: "drizzle", targets: [{ kind: "project" }] }],
				modules: { ddddd: { definitionIds: ["drizzle"], root: "packages/db" } },
			});
			await writeJson(join(directory, "packages/db/forge.json"), {
				capabilities: [],
				id: "ddddd",
				packageType: "library",
				slots: {},
				template: { id: "db", version: 1 },
				type: "package",
			});
			await writeText(
				join(directory, "packages/db/drizzle.config.ts"),
				"export default {};\n",
			);
			await writeJson(join(directory, "packages/db/package.json"), {
				dependencies: { mysql2: "^3.11.0" },
				name: "@acme/db",
			});
			await writeText(
				join(directory, ".env"),
				'DATABASE_URL="mysql://root:password@localhost:3306/acme"\n',
			);

			const project = await loadManagedProject(directory, "add");

			expect(project.config).toStrictEqual({
				addons: ["lefthook"],
				authentication: undefined,
				database: "mysql",
				databaseProvider: undefined,
				linter: "biome",
				name: "acme",
				orm: "drizzle",
				packageManager: "Yarn",
				path: directory,
				rpc: undefined,
				runtime: "Bun",
				slug: "acme",
				style: undefined,
				web: undefined,
			});
		});
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
				"We couldn't run \"update\" here because this project hasn't been bootstrapped with the current Forge metadata yet.",
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
					applyInstalledPlan(directory, { slug: "acme" }, [
						{ definitionId: "missing", targets: [{ kind: "project" }] },
					]),
				).rejects.toThrow("exit:1");
			});

			expect(promptMocks.logError).toHaveBeenCalledWith(
				"We couldn't plan this change. Definition Missing.",
			);
		} finally {
			exit.mockRestore();
		}
	});
});
