import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { NodeServices } from "@effect/platform-node";
import { Apply, CliVersion, State } from "@ryuugg/core";
import { Effect, FileSystem, Layer, PlatformError } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ModuleMappingProposal } from "../src/commands/adoption";
import {
	choosePrimaryWebRoot,
	confirmDetection,
	confirmMappings,
	runInit,
} from "../src/commands/init";
import { withTempDir, writeJson, writeText } from "./lifecycle-fixtures";

async function webFixture(directory: string) {
	await writeJson(join(directory, "package.json"), {
		name: "Acme Root",
		private: true,
	});

	await writeText(
		join(directory, "pnpm-workspace.yaml"),
		"packages:\n  - 'apps/*'\n",
	);

	await writeJson(join(directory, "apps/web/package.json"), {
		dependencies: { next: "^16.0.0", react: "^19.0.0" },
		name: "@acme/web",
		private: true,
	});
}

const promptMocks = vi.hoisted(() => ({
	confirm: vi.fn(),
	error: vi.fn(),
	isCancel: vi.fn(),
	note: vi.fn(),
	multiselect: vi.fn(),
	select: vi.fn(),
}));

vi.mock("@clack/prompts", () => ({
	confirm: promptMocks.confirm,
	cancel: vi.fn(),
	intro: vi.fn(),
	isCancel: promptMocks.isCancel,
	log: { error: promptMocks.error },
	multiselect: promptMocks.multiselect,
	note: promptMocks.note,
	outro: vi.fn(),
	select: promptMocks.select,
}));

describe("init wizard", () => {
	beforeEach(() => {
		promptMocks.confirm.mockReset();
		promptMocks.error.mockReset();

		promptMocks.isCancel.mockReset();
		promptMocks.isCancel.mockReturnValue(false);
		promptMocks.multiselect.mockReset();
		promptMocks.note.mockReset();
		promptMocks.select.mockReset();
	});

	it("refuses pre-existing Forge directories without deleting their contents", async () => {
		await withTempDir("init-existing-forge", async (directory) => {
			const junk = join(directory, ".forge/bases/user-junk");
			await writeText(junk, "keep me\n");
			const exit = vi.spyOn(process, "exit").mockImplementation(() => {
				throw new Error("exit:1");
			});

			try {
				await expect(runInit({ yes: true }, directory)).rejects.toThrow(
					"exit:1",
				);

				expect(promptMocks.error).toHaveBeenCalledWith(
					'A ".forge" directory already exists here. You need to remove it before running forge init.',
				);

				expect(await readFile(junk, "utf-8")).toBe("keep me\n");
			} finally {
				exit.mockRestore();
			}
		});
	});

	it.each(["manifest.json", "lock.json", "state.json"])(
		"refuses unknown versions in %s before adopting",
		async (filename) => {
			await withTempDir("init-unknown-version", async (directory) => {
				const path = join(directory, ".forge", filename);
				await writeJson(
					path,
					filename === "state.json"
						? {
								manifest: { schemaVersion: 1, modules: {} },
								lockfile: { schemaVersion: 99, artifacts: {} },
							}
						: { schemaVersion: 99, modules: {}, artifacts: {} },
				);

				const before = await readFile(path);
				const exit = vi.spyOn(process, "exit").mockImplementation(() => {
					throw new Error("exit:1");
				});

				try {
					await expect(runInit({ yes: true }, directory)).rejects.toThrow(
						"exit:1",
					);

					expect(promptMocks.error).toHaveBeenCalledExactlyOnceWith(
						"We can't read this project's metadata because it was saved by a different version of Forge.",
					);

					expect(await readFile(path)).toEqual(before);
				} finally {
					exit.mockRestore();
				}
			});
		},
	);

	it("explains how to recover an interrupted initial commit", async () => {
		await withTempDir("init-stranded-state", async (directory) => {
			const nodeLayer = NodeServices.layer;
			const fileSystemLayer = Layer.effect(
				FileSystem.FileSystem,
				Effect.map(FileSystem.FileSystem, (fileSystem) => ({
					...fileSystem,
					rename: (oldPath, newPath) =>
						newPath.endsWith("/.forge/lock.json")
							? Effect.fail(
									PlatformError.systemError({
										_tag: "PermissionDenied",
										method: "rename",
										module: "FileSystem",
										pathOrDescriptor: newPath,
									}),
								)
							: fileSystem.rename(oldPath, newPath),
				})),
			).pipe(Layer.provide(nodeLayer));

			const failingLayer = Layer.mergeAll(
				Apply.Default.pipe(
					Layer.provide(
						Layer.succeed(CliVersion, { version: "test-cli-version" }),
					),
				),
				State.Default.pipe(
					Layer.provide(
						Layer.succeed(CliVersion, { version: "test-cli-version" }),
					),
				),
			).pipe(Layer.provide(fileSystemLayer));

			const applyError = await Effect.runPromise(
				Effect.flip(
					Apply.applyPlan(directory, {
						lockfile: { artifacts: {} },
						manifest: { config: {}, installs: [], modules: {} },
						removals: [],
						writes: [{ content: "marker\n", path: "marker.txt" }],
					}).pipe(Effect.provide(failingLayer)),
				),
			);

			expect(applyError).toMatchObject({
				message: "Atomic Lockfile Write Failed",
				path: ".forge/lock.json",
			});

			const exit = vi.spyOn(process, "exit").mockImplementation(() => {
				throw new Error("exit:1");
			});

			try {
				await expect(runInit({ yes: true }, directory)).rejects.toThrow(
					"exit:1",
				);

				expect(promptMocks.error).toHaveBeenCalledWith(
					'A previous Forge adoption stopped before it finished. You need to delete the ".forge" directory, then run forge init again.',
				);
			} finally {
				exit.mockRestore();
			}
		});
	});

	it("uses the root package name for yes mode", async () => {
		await withTempDir("init-yes-name", async (directory) => {
			await webFixture(directory);
			await runInit({ "dry-run": true, yes: true }, directory);

			const [report] = promptMocks.note.mock.calls[0] ?? [];
			expect(report).toContain('"name": "Acme Root"');
			expect(report).toContain('"slug": "acme-root"');
		});
	});

	it.each(["email-otp", "magic-link"])(
		"rejects %s before adopting an email dependency",
		async (method) => {
			await withTempDir("init-email-method", async (directory) => {
				await webFixture(directory);
				const configPath = join(directory, "forge.init.json");
				await writeJson(configPath, {
					addons: [],
					authentication: "better-auth",
					authMethods: [method],
					emailProvider: "resend",
					catalogs: "flat",
					linter: "biome",
					modules: [{ kind: "web-app", root: "apps/web" }],
					name: "Acme",
					packageManager: "pnpm",
					path: ".",
					platforms: ["web"],
					runtime: "Node.js",
					slug: "acme",
					web: "nextjs",
				});

				await expect(
					runInit({ config: configPath }, directory),
				).rejects.toThrow(
					"Email OTP and magic link aren't supported when adopting a project.",
				);
			});
		},
	);

	it("presents unmanaged marker conflicts with init-specific guidance", async () => {
		await withTempDir("init-marker-conflict", async (directory) => {
			await webFixture(directory);
			await writeJson(join(directory, "apps/web/forge.json"), { user: true });
			const configPath = join(directory, "forge.init.json");
			await writeJson(configPath, {
				addons: [],
				catalogs: "flat",
				linter: "biome",
				modules: [{ kind: "web-app", root: "apps/web" }],
				name: "Acme",
				packageManager: "pnpm",
				path: ".",
				platforms: ["web"],
				runtime: "Node.js",
				slug: "acme",
				web: "nextjs",
			});

			const exit = vi.spyOn(process, "exit").mockImplementation(() => {
				throw new Error("exit:1");
			});

			try {
				await expect(
					runInit({ config: configPath }, directory),
				).rejects.toThrow("exit:1");

				expect(promptMocks.error).toHaveBeenCalledWith(
					"We couldn't adopt this project. Forge cannot safely update these files:\napps/web/forge.json already exists and is not managed by Forge.\nMove or delete it, then run forge init again.",
				);
			} finally {
				exit.mockRestore();
			}
		});
	});

	it("stops when a prefill or mapping prompt is cancelled", async () => {
		const exit = vi.spyOn(process, "exit").mockImplementation(() => {
			throw new Error("cancelled");
		});

		try {
			promptMocks.confirm.mockResolvedValue(true);
			promptMocks.isCancel.mockReturnValueOnce(true);
			await expect(
				confirmDetection({
					catalogEntries: [],
					commandPins: {},
					config: { runtime: "Node.js" },
					modules: [],
					tooling: {},
					versions: [],
					webApps: [],
				}),
			).rejects.toThrow("cancelled");

			promptMocks.multiselect.mockResolvedValue([]);
			promptMocks.isCancel.mockReturnValueOnce(true);
			await expect(
				confirmMappings([
					{
						evidence: "found next in its dependencies",
						proposal: "web-app",
						root: "apps/web",
					},
				]),
			).rejects.toThrow("cancelled");
		} finally {
			exit.mockRestore();
		}
	});

	it("shows detected values as confirmable prefills", async () => {
		promptMocks.confirm
			.mockResolvedValueOnce(true)
			.mockResolvedValueOnce(false);

		const config = await confirmDetection({
			catalogEntries: [],
			commandPins: {},
			config: { packageManager: "pnpm", runtime: "Node.js" },
			modules: [],
			tooling: {},
			versions: [],
			webApps: [],
		});

		expect(config).toEqual({ packageManager: "pnpm" });
		expect(promptMocks.confirm).toHaveBeenNthCalledWith(1, {
			initialValue: true,
			message: "We detected packageManager as pnpm. Use it?",
		});

		expect(promptMocks.confirm).toHaveBeenNthCalledWith(2, {
			initialValue: true,
			message: "We detected runtime as Node.js. Use it?",
		});
	});

	it("asks which web app is primary when apps/web isn't adopted", async () => {
		promptMocks.select.mockResolvedValue("apps/frontend");

		await expect(
			choosePrimaryWebRoot(
				[
					{ kind: "web-app", root: "apps/admin" },
					{ kind: "web-app", root: "apps/frontend" },
					{ kind: "db", root: "packages/db" },
				],
				[
					{
						rpcPackages: [],
						frameworks: ["react-router"],
						root: "apps/admin",
						scriptPort: { kind: "absent" },
					},
					{
						rpcPackages: [],
						frameworks: ["nextjs"],
						root: "apps/frontend",
						scriptPort: { kind: "absent" },
					},
				],
				true,
			),
		).resolves.toBe("apps/frontend");

		expect(promptMocks.select).toHaveBeenCalledExactlyOnceWith({
			message: "Which web app is the primary app?",
			options: [
				{ label: "apps/admin (React Router)", value: "apps/admin" },
				{ label: "apps/frontend (Next.js)", value: "apps/frontend" },
			],
		});

		await expect(
			choosePrimaryWebRoot(
				[
					{ kind: "web-app", root: "apps/site" },
					{ kind: "web-app", root: "apps/web" },
				],
				[],
				true,
			),
		).resolves.toBe("apps/web");

		expect(promptMocks.select).toHaveBeenCalledTimes(1);
	});

	it("writes nothing when the primary web app prompt is cancelled", async () => {
		await withTempDir("init-primary-cancel", async (directory) => {
			await writeJson(join(directory, "package.json"), { name: "acme" });
			await writeText(
				join(directory, "pnpm-workspace.yaml"),
				"packages:\n  - 'apps/*'\n",
			);

			await writeJson(join(directory, "apps/admin/package.json"), {
				dependencies: { "react-router": "^7.0.0" },
			});

			await writeJson(join(directory, "apps/frontend/package.json"), {
				dependencies: { next: "^16.0.0" },
			});

			promptMocks.multiselect.mockResolvedValue([
				"apps/admin",
				"apps/frontend",
			]);

			promptMocks.select.mockResolvedValue(Symbol("cancel"));
			promptMocks.isCancel.mockImplementation(
				(value: unknown) => typeof value === "symbol",
			);

			const exit = vi.spyOn(process, "exit").mockImplementation(() => {
				throw new Error("cancelled");
			});

			try {
				await expect(runInit({}, directory)).rejects.toThrow("cancelled");
				expect(promptMocks.select).toHaveBeenCalledOnce();
				expect(promptMocks.confirm).not.toHaveBeenCalled();
				await expect(
					readFile(join(directory, ".forge/manifest.json")),
				).rejects.toThrow();
			} finally {
				exit.mockRestore();
			}
		});
	});

	it("keeps rejected module proposals out of adoption", async () => {
		promptMocks.multiselect.mockResolvedValue(["apps/web"]);
		const proposals: ReadonlyArray<ModuleMappingProposal> = [
			{
				evidence: "found next in its dependencies",
				proposal: "web-app",
				root: "apps/web",
			},
			{
				evidence: "found drizzle-orm in its dependencies",
				proposal: "db",
				root: "packages/db",
			},
		];

		await expect(confirmMappings(proposals)).resolves.toEqual([
			{ kind: "web-app", root: "apps/web" },
		]);

		expect(promptMocks.multiselect).toHaveBeenCalledWith({
			initialValues: ["apps/web", "packages/db"],
			message: "Which proposed module mappings do you want Forge to adopt?",
			options: [
				{
					hint: "We found next in its dependencies.",
					label: "apps/web as web-app",
					value: "apps/web",
				},
				{
					hint: "We found drizzle-orm in its dependencies.",
					label: "packages/db as db",
					value: "packages/db",
				},
			],
			required: false,
		});
	});
});
