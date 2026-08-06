import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { FileSystem, Error as PlatformError } from "@effect/platform";
import { NodeContext } from "@effect/platform-node";
import { Apply, State } from "@ryuujs/core";
import { Effect, Layer } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ModuleMappingProposal } from "../src/commands/adoption";
import {
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
}));

describe("init wizard", () => {
	beforeEach(() => {
		promptMocks.confirm.mockReset();
		promptMocks.error.mockReset();
		promptMocks.isCancel.mockReset();
		promptMocks.isCancel.mockReturnValue(false);
		promptMocks.multiselect.mockReset();
		promptMocks.note.mockReset();
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
					'A ".forge" directory already exists here. Remove it before running forge init.',
				);
				expect(await readFile(junk, "utf-8")).toBe("keep me\n");
			} finally {
				exit.mockRestore();
			}
		});
	});

	it("explains how to recover an interrupted initial commit", async () => {
		await withTempDir("init-stranded-state", async (directory) => {
			const nodeLayer = NodeContext.layer;
			const fileSystemLayer = Layer.effect(
				FileSystem.FileSystem,
				Effect.map(FileSystem.FileSystem, (fileSystem) => ({
					...fileSystem,
					rename: (oldPath, newPath) =>
						newPath.endsWith("/.forge/lock.json")
							? Effect.fail(
									new PlatformError.SystemError({
										method: "rename",
										module: "FileSystem",
										pathOrDescriptor: newPath,
										reason: "PermissionDenied",
									}),
								)
							: fileSystem.rename(oldPath, newPath),
				})),
			).pipe(Layer.provide(nodeLayer));
			const failingLayer = Layer.mergeAll(Apply.Default, State.Default).pipe(
				Layer.provide(fileSystemLayer),
			);
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
					'A previous Forge adoption stopped before it finished. Delete the ".forge" directory, then run forge init again.',
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
			expect(report).toContain("name=Acme Root");
			expect(report).toContain("slug=acme-root");
		});
	});

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
					config: { runtime: "Node.js" },
					modules: [],
					tooling: {},
					versions: [],
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
			config: { packageManager: "pnpm", runtime: "Node.js" },
			modules: [],
			tooling: {},
			versions: [],
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
