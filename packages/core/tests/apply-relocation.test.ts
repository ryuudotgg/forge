import {
	mkdir,
	readdir,
	readFile,
	rename,
	rm,
	symlink,
} from "node:fs/promises";
import { join, relative } from "node:path";
import { NodeServices } from "@effect/platform-node";
import { Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";
import {
	Apply,
	ApplyError,
	CliVersion,
	ConfigStore,
	CoreLive,
	type DirectoryMove,
	defineFramework,
	defineRegistry,
	defineTemplate,
	ensureAppModule,
	ensuredModuleTarget,
	formatApplyError,
	leafTextFile,
	Planner,
	type ProjectPlan,
	State,
	surfaceJson,
	surfaceText,
} from "../src/index";
import { withTempDir, writeJson, writeText } from "./harness";

type RenameConfig = {
	readonly web: "nextjs";
	readonly webName?: string;
	readonly omitGenerated?: boolean;
};

const layer = CoreLive.pipe(
	Layer.provide(Layer.succeed(CliVersion, { version: "test-cli-version" })),
	Layer.provideMerge(NodeServices.layer),
);

const registry = defineRegistry({
	addons: [],
	adapters: [],
	frameworks: [
		defineFramework({
			id: "nextjs",
			name: "Next.js",
			configFile: "next.config.ts",
			sourceRoot: "",
			slots: ["page"],
			buildOutputs: [],
			ignoreDirs: [],
			tsconfigPreset: { content: {}, name: "nextjs" },
		}),
	],
	templates: [
		defineTemplate<RenameConfig>({
			id: "nextjs/base",
			name: "Next.js",
			framework: "nextjs",
			version: 1,
			category: "web",
			when: () => true,
			contribute: ({ config }) => {
				const name = config.webName ?? "web";
				const target = ensuredModuleTarget(name);
				return [
					ensureAppModule(name, `apps/${name}`, {
						framework: "nextjs",
						template: { id: "nextjs/base", version: 1 },
						slots: { page: "app/page.tsx" },
					}),
					surfaceJson(target, "packageJson", { name: `@acme/${name}` }),
					surfaceText(target, "page", "generated page\n"),
					leafTextFile(target, "logo.txt", "opaque original\n"),
					...(config.omitGenerated === true
						? []
						: [
								leafTextFile(target, "generated.txt", "remove me\n", {
									generated: true,
								}),
							]),
				];
			},
		}),
	],
});

function create(root: string) {
	return Effect.runPromise(
		Effect.flatMap(Planner, (planner) =>
			planner.planCreate(
				root,
				{ web: "nextjs" } satisfies RenameConfig,
				registry,
				{},
			),
		).pipe(Effect.provide(layer)),
	);
}

function installed(
	root: string,
	moves?: ReadonlyArray<DirectoryMove>,
	omitGenerated = false,
) {
	return Effect.runPromise(
		Effect.gen(function* () {
			const planner = yield* Planner;
			const manifest = yield* State.readManifest(root);
			const modules = yield* ConfigStore.discover(root);
			return yield* planner.planInstalled(
				root,
				{
					web: "nextjs",
					webName: "vault",
					omitGenerated,
				} satisfies RenameConfig,
				manifest.installs,
				registry,
				{},
				undefined,
				undefined,
				moves === undefined
					? undefined
					: { modules, records: manifest.modules, directoryMoves: moves },
			);
		}).pipe(Effect.provide(layer)),
	);
}

function apply(root: string, plan: ProjectPlan) {
	return Effect.runPromise(
		Apply.applyPlan(root, plan).pipe(Effect.provide(layer)),
	);
}

async function tree(root: string) {
	const entries = await readdir(root, { recursive: true, withFileTypes: true });
	const files: Record<string, string> = {};
	for (const entry of entries) {
		if (!entry.isFile()) continue;
		const path = join(entry.parentPath, entry.name);
		files[relative(root, path)] = (await readFile(path)).toString("hex");
	}

	return files;
}

async function fixture(root: string) {
	const plan = await create(root);
	await apply(root, plan);

	await writeText(join(root, "apps/web/app/page.tsx"), "edited page\n");
	await writeText(join(root, "apps/web/logo.txt"), "edited opaque leaf\n");
	await writeText(join(root, "apps/web/custom.bin"), "\0unmanaged\u00ff\n");

	const moduleId = Object.keys(plan.manifest.modules)[0];
	if (moduleId === undefined) throw new Error("Fixture Module Missing");

	return { plan, move: { moduleId, from: "apps/web", to: "apps/vault" } };
}

describe("directory publication", () => {
	it("moves an app and its nested managed module with their ids and lock artifacts", async () => {
		await withTempDir("relocation-nested", async (root) => {
			const { move } = await fixture(root);
			const nestedId = "fghij";
			await writeJson(join(root, "apps/web/packages/utils/forge.json"), {
				id: nestedId,
				type: "package",
				packageType: "library",
				template: { id: "library/base", version: 1 },
				capabilities: [],
				slots: {},
			});

			const initial = await Effect.runPromise(
				Effect.flatMap(Planner, (planner) =>
					planner.planInstalled(
						root,
						{ web: "nextjs" } satisfies RenameConfig,
						[],
						registry,
						{},
					),
				).pipe(Effect.provide(layer)),
			);

			await Effect.runPromise(
				Apply.applyPlan(root, initial, {
					resolutionPolicy: "accept-forge",
				}).pipe(Effect.provide(layer)),
			);

			expect(initial.manifest.modules[nestedId]?.root).toBe(
				"apps/web/packages/utils",
			);

			expect(
				initial.lockfile.artifacts[`module:${nestedId}:file:forge.json`]?.path,
			).toBe("apps/web/packages/utils/forge.json");

			const plan = await installed(root, [move]);
			expect(plan.manifest.modules[move.moduleId]?.root).toBe("apps/vault");
			expect(plan.manifest.modules[nestedId]?.root).toBe(
				"apps/vault/packages/utils",
			);

			expect(
				plan.writes.some((write) => write.path.startsWith("apps/web/")),
			).toBe(false);

			await apply(root, plan);

			const modules = await Effect.runPromise(
				ConfigStore.discover(root).pipe(Effect.provide(layer)),
			);

			expect(modules.map(({ id, root }) => ({ id, root }))).toEqual(
				expect.arrayContaining([
					{ id: move.moduleId, root: "apps/vault" },
					{ id: nestedId, root: "apps/vault/packages/utils" },
				]),
			);

			expect(await readdir(join(root, "apps"))).toEqual(["vault"]);

			const lock = await Effect.runPromise(
				State.readLockfile(root).pipe(Effect.provide(layer)),
			);

			expect(lock.artifacts[`module:${nestedId}:file:forge.json`]?.path).toBe(
				"apps/vault/packages/utils/forge.json",
			);

			expect(
				Object.values(lock.artifacts).every(
					(artifact) => !artifact.path.startsWith("apps/web/"),
				),
			).toBe(true);
		});
	});

	it.each(["retained", "dropped"])(
		"reports %s removals at their moved paths",
		async (report) => {
			await withTempDir("relocation-removal-report", async (root) => {
				const { move } = await fixture(root);
				const plan = await installed(root, [move]);
				const path =
					report === "retained"
						? "apps/vault/custom.bin"
						: "apps/vault/logo.txt";

				const removals = [...plan.removals, path];
				const writes = plan.writes.filter((write) => write.path !== path);
				const result = await Effect.runPromise(
					Apply.applyPlan(
						root,
						{ ...plan, writes, removals },
						report === "retained"
							? { resolutionPolicy: "keep-user" }
							: {
									departing: {
										definitionIds: ["nextjs/base"],
										committedPaths: ["apps/web/logo.txt"],
									},
								},
					).pipe(Effect.provide(layer)),
				);

				if (report === "retained") expect(result.retained).toContain(path);
				else
					expect(result.dropped).toEqual([
						{ path, lines: "edited opaque leaf\n" },
					]);
			});
		},
	);

	it.each(["write", "removal"])(
		"refuses a planned %s into a vacated root before publication",
		async (operation) => {
			await withTempDir("relocation-vacated", async (root) => {
				const { move } = await fixture(root);
				const plan = await installed(root, [move]);
				const write = plan.writes[0];
				if (write === undefined) throw new Error("Fixture Write Missing");

				const unsafe =
					operation === "write"
						? {
								...plan,
								writes: [
									...plan.writes,
									{ ...write, path: "apps/web/new.txt", content: "new app\n" },
								],
							}
						: { ...plan, removals: [...plan.removals, "apps/web/logo.txt"] };

				const before = await tree(root);

				await expect(apply(root, unsafe)).rejects.toThrow(
					"Directory Move Source Reused: apps/web",
				);

				expect(await tree(root)).toEqual(before);
			});
		},
	);

	it("records declined changes at their moved paths", async () => {
		await withTempDir("relocation-declined", async (root) => {
			const { move } = await fixture(root);
			const plan = await installed(root, [move]);
			const writes = plan.writes.map((write) =>
				write.path.endsWith("app/page.tsx")
					? { ...write, content: "new page\n" }
					: write,
			);

			const result = await Effect.runPromise(
				Apply.applyPlan(
					root,
					{ ...plan, writes },
					{ resolutionPolicy: "keep-user" },
				).pipe(Effect.provide(layer)),
			);

			expect(result.declined[0]?.path).toBe("apps/vault/app/page.tsx");
			expect(result.declined[0]?.diffPath).toBe(
				".forge/declined/apps/vault/app/page.tsx.diff",
			);

			expect(result.declined[0]?.diff).toContain("apps/vault/app/page.tsx");
		});
	});

	it("cleans empty removed directories at the moved root", async () => {
		await withTempDir("relocation-empty", async (root) => {
			const { move } = await fixture(root);
			const plan = await installed(root, [move]);
			await writeText(
				join(root, "apps/web/empty/generated.txt"),
				"generated\n",
			);

			await Effect.runPromise(
				Apply.applyPlan(
					root,
					{ ...plan, removals: ["apps/vault/empty/generated.txt"] },
					{ resolutionPolicy: "accept-forge" },
				).pipe(Effect.provide(layer)),
			);

			expect(await readdir(join(root, "apps/vault"))).not.toContain("empty");
		});
	});

	it.each(["forge", "hand", "crash"])(
		"preserves edited bytes, ids and bases after a %s move",
		async (mode) => {
			await withTempDir(`relocation-${mode}`, async (root) => {
				const { move } = await fixture(root);
				const beforeLock = await Effect.runPromise(
					State.readLockfile(root).pipe(Effect.provide(layer)),
				);

				const manifest = await Effect.runPromise(
					State.readManifest(root).pipe(Effect.provide(layer)),
				);

				if (mode !== "forge")
					await rename(join(root, move.from), join(root, move.to));

				if (mode === "crash")
					await writeJson(join(root, ".forge/state.json"), {
						manifest: {
							...manifest,
							config: { web: "nextjs", webName: "vault" },
						},
						lockfile: beforeLock,
					});

				const plan = await installed(
					root,
					mode === "forge" ? [move] : undefined,
				);

				expect(plan.manifest.modules[move.moduleId]?.root).toBe(move.to);
				expect(plan.removals).toEqual([]);
				await apply(root, plan);

				for (const [path, content] of [
					["app/page.tsx", "edited page\n"],
					["logo.txt", "edited opaque leaf\n"],
					["custom.bin", "\0unmanaged\u00ff\n"],
				])
					expect(await readFile(join(root, move.to, path ?? ""), "utf8")).toBe(
						content,
					);

				expect((await readdir(join(root, "apps"))).sort()).toEqual(["vault"]);
				expect(
					await readFile(join(root, "apps/vault/package.json"), "utf8"),
				).toContain("@acme/vault");

				const lock = await Effect.runPromise(
					State.readLockfile(root).pipe(Effect.provide(layer)),
				);

				for (const artifact of Object.values(lock.artifacts)) {
					expect(artifact.path.startsWith("apps/vault/")).toBe(true);

					if (artifact.base !== undefined)
						expect(
							await readFile(
								join(root, ".forge/bases", artifact.base.hash),
								"utf8",
							),
						).not.toBe("");
				}

				expect(Object.keys(lock.artifacts).join("\n")).not.toContain(
					"apps/web",
				);

				expect(Object.keys(lock.artifacts)).toContain(
					`module:${move.moduleId}:file:forge.json`,
				);

				expect(await readdir(join(root, ".forge"))).not.toContain("state.json");
				const before = await tree(root);
				await apply(root, await installed(root));
				expect(await tree(root)).toEqual(before);
			});
		},
	);

	it.each(["directory", "dangling-symlink"])(
		"refuses an occupied %s destination without writes",
		async (kind) => {
			await withTempDir("relocation-occupied", async (root) => {
				const { move } = await fixture(root);
				if (kind === "directory") await mkdir(join(root, move.to));
				else await symlink("missing", join(root, move.to));

				const before = await tree(root);
				const plan = await installed(root, [move]);
				const failure = await Effect.runPromise(
					Apply.applyPlan(root, plan).pipe(Effect.flip, Effect.provide(layer)),
				);

				if (!(failure instanceof ApplyError)) throw failure;

				expect(formatApplyError(failure)).toContain(
					"apps/vault already exists",
				);

				expect(await tree(root)).toEqual(before);
			});
		},
	);

	it("accepts an already completed move using the previous state bundle", async () => {
		await withTempDir("relocation-completed", async (root) => {
			const { move } = await fixture(root);
			const plan = await installed(root, [move]);
			await rename(join(root, move.from), join(root, move.to));
			await apply(root, plan);

			expect(
				await readFile(join(root, "apps/vault/app/page.tsx"), "utf8"),
			).toBe("edited page\n");
		});
	});

	it.each(["missing", "wrong-marker"])(
		"refuses a %s source without writes",
		async (kind) => {
			await withTempDir("relocation-source", async (root) => {
				const { move } = await fixture(root);
				const plan = await installed(root, [move]);

				if (kind === "missing")
					await rm(join(root, move.from), { recursive: true });
				else
					await writeJson(join(root, move.from, "forge.json"), { id: "pqrst" });

				const before = await tree(root);
				const failure = await Effect.runPromise(
					Apply.applyPlan(root, plan).pipe(Effect.flip, Effect.provide(layer)),
				);

				if (!(failure instanceof ApplyError)) throw failure;

				expect(formatApplyError(failure)).toContain(
					"apps/web is missing or no longer holds the module",
				);

				expect(await tree(root)).toEqual(before);
			});
		},
	);

	it("keeps preserved artifact paths at the destination", async () => {
		await withTempDir("relocation-preserved", async (root) => {
			const { move } = await fixture(root);
			const plan = await installed(root, [move]);
			await apply(root, {
				...plan,
				writes: plan.writes.map((write) =>
					write.path.endsWith("logo.txt")
						? { ...write, preserveExisting: true }
						: write,
				),
			});

			const lock = await Effect.runPromise(
				State.readLockfile(root).pipe(Effect.provide(layer)),
			);

			expect(
				Object.values(lock.artifacts).find((artifact) =>
					artifact.path.endsWith("logo.txt"),
				)?.path,
			).toBe("apps/vault/logo.txt");

			expect(await readFile(join(root, "apps/vault/logo.txt"), "utf8")).toBe(
				"edited opaque leaf\n",
			);
		});
	});

	it("plans real removals at the new root and removes them after moving", async () => {
		await withTempDir("relocation-removal", async (root) => {
			const { move } = await fixture(root);
			const plan = await installed(root, [move], true);
			expect(plan.removals).toEqual(["apps/vault/generated.txt"]);

			await apply(root, plan);
			expect(await readdir(join(root, "apps/vault"))).not.toContain(
				"generated.txt",
			);

			expect(await readFile(join(root, "apps/vault/logo.txt"), "utf8")).toBe(
				"edited opaque leaf\n",
			);
		});
	});

	it("rejects a planner move that cannot reach the requested root", async () => {
		await withTempDir("relocation-planner-mismatch", async (root) => {
			const { move } = await fixture(root);
			const before = await tree(root);

			await expect(
				installed(root, [{ ...move, moduleId: "pqrst" }]),
			).rejects.toThrow("Directory Move Mismatch: apps/web");

			expect(await tree(root)).toEqual(before);
		});
	});

	it("names the source file when a moved render conflicts", async () => {
		await withTempDir("relocation-conflict", async (root) => {
			const { move } = await fixture(root);
			const plan = await installed(root, [move]);
			const writes = plan.writes.map((write) =>
				write.path.endsWith("app/page.tsx")
					? { ...write, content: "new generated page\n" }
					: write,
			);

			const before = await tree(root);
			const failure = await Effect.runPromise(
				Apply.applyPlan(root, { ...plan, writes }).pipe(
					Effect.flip,
					Effect.provide(layer),
				),
			);

			if (!(failure instanceof ApplyError)) throw failure;

			expect(formatApplyError(failure)).toContain(
				"apps/web/app/page.tsx was modified",
			);

			expect(await tree(root)).toEqual(before);
		});
	});

	it("rejects a move inconsistent with the manifest before writing", async () => {
		await withTempDir("relocation-mismatch", async (root) => {
			const { move } = await fixture(root);
			const plan = await installed(root, [move]);
			const before = await tree(root);

			await expect(
				apply(root, {
					...plan,
					directoryMoves: [{ ...move, from: "apps/other" }],
				}),
			).rejects.toThrow("Directory Move Mismatch: apps/other");

			expect(await tree(root)).toEqual(before);
		});
	});
});
