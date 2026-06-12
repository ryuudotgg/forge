import { mkdir, readFile, stat, symlink } from "node:fs/promises";
import { join } from "node:path";
import { NodeContext } from "@effect/platform-node";
import { Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";
import { Apply, CoreLive, type Lockfile, State } from "../src/index";
import { readJson, withTempDir, writeText } from "./harness";

async function pathExists(path: string) {
	try {
		await stat(path);
		return true;
	} catch {
		return false;
	}
}

const coreLayer = CoreLive.pipe(Layer.provideMerge(NodeContext.layer));

async function hashContent(content: string) {
	const buffer = await crypto.subtle.digest(
		"SHA-256",
		new TextEncoder().encode(content),
	);

	return Array.from(new Uint8Array(buffer))
		.map((byte) => byte.toString(16).padStart(2, "0"))
		.join("");
}

describe("apply", () => {
	it("refuses to overwrite a modified managed file", async () => {
		await withTempDir("apply-overwrite", async (directory) => {
			await writeText(`${directory}/apps/web/app/layout.tsx`, "user-change\n");

			const previousLockfile: Lockfile = {
				artifacts: {
					"project:file:apps/web/app/layout.tsx": {
						definitionIds: ["nextjs/base"],
						hash: await hashContent("old-managed\n"),
						kind: "file",
						path: "apps/web/app/layout.tsx",
					},
				},
			};

			await Effect.runPromise(
				State.writeLockfile(directory, previousLockfile).pipe(
					Effect.provide(coreLayer),
				),
			);

			const error = await Effect.runPromise(
				Effect.flip(
					Apply.applyPlan(directory, {
						lockfile: { artifacts: {} },
						manifest: { config: {}, installs: [], modules: {} },
						removals: [],
						writes: [
							{
								content: "new-managed\n",
								path: "apps/web/app/layout.tsx",
							},
						],
					}).pipe(Effect.provide(coreLayer)),
				),
			);

			expect(error).toMatchObject({
				_tag: "ApplyError",
				message: "Managed File Modified",
				path: "apps/web/app/layout.tsx",
			});

			expect(
				await readFile(`${directory}/apps/web/app/layout.tsx`, "utf-8"),
			).toBe("user-change\n");

			expect(await readJson(join(directory, ".forge/lock.json"))).toEqual(
				previousLockfile,
			);

			expect(await pathExists(join(directory, ".forge/manifest.json"))).toBe(
				false,
			);
		});
	});

	it("refuses to remove a modified managed file", async () => {
		await withTempDir("apply-remove", async (directory) => {
			await writeText(`${directory}/packages/ui/forge.json`, "{\n}\n");

			const previousLockfile: Lockfile = {
				artifacts: {
					"project:file:packages/ui/forge.json": {
						definitionIds: ["ui"],
						hash: await hashContent('{\n\t"old": true\n}\n'),
						kind: "file",
						path: "packages/ui/forge.json",
					},
				},
			};

			await Effect.runPromise(
				State.writeLockfile(directory, previousLockfile).pipe(
					Effect.provide(coreLayer),
				),
			);

			const error = await Effect.runPromise(
				Effect.flip(
					Apply.applyPlan(directory, {
						lockfile: { artifacts: {} },
						manifest: { config: {}, installs: [], modules: {} },
						removals: ["packages/ui/forge.json"],
						writes: [],
					}).pipe(Effect.provide(coreLayer)),
				),
			);

			expect(error).toMatchObject({
				_tag: "ApplyError",
				message: "Managed File Modified",
				path: "packages/ui/forge.json",
			});

			expect(
				await readFile(`${directory}/packages/ui/forge.json`, "utf-8"),
			).toBe("{\n}\n");

			expect(await readJson(join(directory, ".forge/lock.json"))).toEqual(
				previousLockfile,
			);

			expect(await pathExists(join(directory, ".forge/manifest.json"))).toBe(
				false,
			);
		});
	});

	it("refuses to overwrite an unmanaged file", async () => {
		await withTempDir("apply-unmanaged-write", async (directory) => {
			await writeText(
				join(directory, "apps/web/app/layout.tsx"),
				"user-owned\n",
			);

			const error = await Effect.runPromise(
				Effect.flip(
					Apply.applyPlan(directory, {
						lockfile: { artifacts: {} },
						manifest: { config: {}, installs: [], modules: {} },
						removals: [],
						writes: [
							{
								content: "generated\n",
								path: "apps/web/app/layout.tsx",
							},
						],
					}).pipe(Effect.provide(coreLayer)),
				),
			);

			expect(error).toMatchObject({
				_tag: "ApplyError",
				message: "Unmanaged File Exists",
				path: "apps/web/app/layout.tsx",
			});

			expect(
				await readFile(join(directory, "apps/web/app/layout.tsx"), "utf-8"),
			).toBe("user-owned\n");
		});
	});

	it("refuses to remove an unmanaged file", async () => {
		await withTempDir("apply-unmanaged-remove", async (directory) => {
			await writeText(join(directory, "packages/ui/notes.txt"), "keep me\n");

			const error = await Effect.runPromise(
				Effect.flip(
					Apply.applyPlan(directory, {
						lockfile: { artifacts: {} },
						manifest: { config: {}, installs: [], modules: {} },
						removals: ["packages/ui/notes.txt"],
						writes: [],
					}).pipe(Effect.provide(coreLayer)),
				),
			);

			expect(error).toMatchObject({
				_tag: "ApplyError",
				message: "Unmanaged File Exists",
				path: "packages/ui/notes.txt",
			});

			expect(
				await readFile(join(directory, "packages/ui/notes.txt"), "utf-8"),
			).toBe("keep me\n");
		});
	});

	it("re-applies an identical plan without touching matching files", async () => {
		await withTempDir("apply-idempotent", async (directory) => {
			const plan = {
				lockfile: { artifacts: {} },
				manifest: { config: {}, installs: [], modules: {} },
				removals: [],
				writes: [{ content: "export {};\n", path: "packages/db/src/index.ts" }],
			};

			await Effect.runPromise(
				Apply.applyPlan(directory, plan).pipe(Effect.provide(coreLayer)),
			);

			expect(
				await readFile(join(directory, "packages/db/src/index.ts"), "utf-8"),
			).toBe("export {};\n");

			expect(await readJson(join(directory, ".forge/manifest.json"))).toEqual(
				plan.manifest,
			);

			expect(await readJson(join(directory, ".forge/lock.json"))).toEqual(
				plan.lockfile,
			);

			await Effect.runPromise(
				Apply.applyPlan(directory, plan).pipe(Effect.provide(coreLayer)),
			);

			expect(
				await readFile(join(directory, "packages/db/src/index.ts"), "utf-8"),
			).toBe("export {};\n");
		});
	});

	it("accepts a moved artifact whose content matches its lockfile hash", async () => {
		await withTempDir("apply-move", async (directory) => {
			const movedContent = "export const db = {};\n";

			await writeText(join(directory, "new/path.ts"), movedContent);

			await Effect.runPromise(
				State.writeLockfile(directory, {
					artifacts: {
						"project:file:old/path.ts": {
							definitionIds: ["drizzle"],
							hash: await hashContent(movedContent),
							kind: "file",
							path: "old/path.ts",
						},
					},
				}).pipe(Effect.provide(coreLayer)),
			);

			await Effect.runPromise(
				Apply.applyPlan(directory, {
					lockfile: { artifacts: {} },
					manifest: { config: {}, installs: [], modules: {} },
					removals: [],
					writes: [
						{
							artifactId: "project:file:old/path.ts",
							content: "export const db = { fresh: true };\n",
							path: "new/path.ts",
						},
					],
				}).pipe(Effect.provide(coreLayer)),
			);

			expect(await readFile(join(directory, "new/path.ts"), "utf-8")).toBe(
				"export const db = { fresh: true };\n",
			);
		});
	});

	it("refuses to overwrite a modified moved artifact", async () => {
		await withTempDir("apply-move-modified", async (directory) => {
			await writeText(join(directory, "new/path.ts"), "user-tweak\n");

			await Effect.runPromise(
				State.writeLockfile(directory, {
					artifacts: {
						"project:file:old/path.ts": {
							definitionIds: ["drizzle"],
							hash: await hashContent("export const db = {};\n"),
							kind: "file",
							path: "old/path.ts",
						},
					},
				}).pipe(Effect.provide(coreLayer)),
			);

			const error = await Effect.runPromise(
				Effect.flip(
					Apply.applyPlan(directory, {
						lockfile: { artifacts: {} },
						manifest: { config: {}, installs: [], modules: {} },
						removals: [],
						writes: [
							{
								artifactId: "project:file:old/path.ts",
								content: "export const db = { fresh: true };\n",
								path: "new/path.ts",
							},
						],
					}).pipe(Effect.provide(coreLayer)),
				),
			);

			expect(error).toMatchObject({
				_tag: "ApplyError",
				message: "Managed File Modified",
				path: "new/path.ts",
			});

			expect(await readFile(join(directory, "new/path.ts"), "utf-8")).toBe(
				"user-tweak\n",
			);
		});
	});

	it("always rewrites forge.json artifacts even when hand-edited", async () => {
		await withTempDir("apply-forge-json", async (directory) => {
			await writeText(
				join(directory, "apps/web/forge.json"),
				'{\n\t"id": "abcde",\n\t"edited": true\n}\n',
			);

			await Effect.runPromise(
				State.writeLockfile(directory, {
					artifacts: {
						"module:abcde:file:forge.json": {
							definitionIds: ["nextjs/base"],
							hash: await hashContent('{\n\t"id": "abcde"\n}\n'),
							kind: "file",
							path: "apps/web/forge.json",
						},
					},
				}).pipe(Effect.provide(coreLayer)),
			);

			await Effect.runPromise(
				Apply.applyPlan(directory, {
					lockfile: { artifacts: {} },
					manifest: { config: {}, installs: [], modules: {} },
					removals: [],
					writes: [
						{
							artifactId: "module:abcde:file:forge.json",
							content: '{\n\t"id": "abcde",\n\t"slots": {}\n}\n',
							path: "apps/web/forge.json",
						},
					],
				}).pipe(Effect.provide(coreLayer)),
			);

			expect(
				await readFile(join(directory, "apps/web/forge.json"), "utf-8"),
			).toBe('{\n\t"id": "abcde",\n\t"slots": {}\n}\n');
		});
	});

	it("prunes emptied directories after removals and stops at non-empty ancestors", async () => {
		await withTempDir("apply-prune", async (directory) => {
			const removedFile = "packages/db/src/schema/index.ts";
			const siblingFile = "packages/trpc/src/index.ts";
			const content = "export {};\n";

			await writeText(join(directory, removedFile), content);
			await writeText(join(directory, siblingFile), content);

			await Effect.runPromise(
				State.writeLockfile(directory, {
					artifacts: {
						[`project:file:${removedFile}`]: {
							definitionIds: ["drizzle"],
							hash: await hashContent(content),
							kind: "file",
							path: removedFile,
						},
					},
				}).pipe(Effect.provide(coreLayer)),
			);

			await Effect.runPromise(
				Apply.applyPlan(directory, {
					lockfile: { artifacts: {} },
					manifest: { config: {}, installs: [], modules: {} },
					removals: [removedFile],
					writes: [],
				}).pipe(Effect.provide(coreLayer)),
			);

			expect(await pathExists(join(directory, "packages/db"))).toBe(false);
			expect(await pathExists(join(directory, siblingFile))).toBe(true);
			expect(await pathExists(join(directory, "packages"))).toBe(true);
		});
	});

	it("keeps directories that still contain unmanaged files", async () => {
		await withTempDir("apply-prune-keep", async (directory) => {
			const removedFile = "packages/db/src/index.ts";
			const content = "export {};\n";

			await writeText(join(directory, removedFile), content);
			await writeText(join(directory, "packages/db/notes.txt"), "keep me\n");

			await Effect.runPromise(
				State.writeLockfile(directory, {
					artifacts: {
						[`project:file:${removedFile}`]: {
							definitionIds: ["drizzle"],
							hash: await hashContent(content),
							kind: "file",
							path: removedFile,
						},
					},
				}).pipe(Effect.provide(coreLayer)),
			);

			await Effect.runPromise(
				Apply.applyPlan(directory, {
					lockfile: { artifacts: {} },
					manifest: { config: {}, installs: [], modules: {} },
					removals: [removedFile],
					writes: [],
				}).pipe(Effect.provide(coreLayer)),
			);

			expect(await pathExists(join(directory, "packages/db/src"))).toBe(false);
			expect(
				await readFile(join(directory, "packages/db/notes.txt"), "utf-8"),
			).toBe("keep me\n");
		});
	});

	it("does not prune directories that resolve outside the project root", async () => {
		await withTempDir("apply-prune-escape", async (scratch) => {
			const projectRoot = join(scratch, "project");
			const outside = join(scratch, "outside");
			const removedFile = "packages/link/sub/index.ts";
			const content = "export {};\n";

			await mkdir(join(outside, "sub"), { recursive: true });
			await mkdir(join(projectRoot, "packages"), { recursive: true });
			await symlink(outside, join(projectRoot, "packages/link"));
			await writeText(join(projectRoot, removedFile), content);

			await Effect.runPromise(
				State.writeLockfile(projectRoot, {
					artifacts: {
						[`project:file:${removedFile}`]: {
							definitionIds: ["drizzle"],
							hash: await hashContent(content),
							kind: "file",
							path: removedFile,
						},
					},
				}).pipe(Effect.provide(coreLayer)),
			);

			await Effect.runPromise(
				Apply.applyPlan(projectRoot, {
					lockfile: { artifacts: {} },
					manifest: { config: {}, installs: [], modules: {} },
					removals: [removedFile],
					writes: [],
				}).pipe(Effect.provide(coreLayer)),
			);

			expect(await pathExists(join(outside, "sub/index.ts"))).toBe(false);
			expect(await pathExists(join(outside, "sub"))).toBe(true);
			expect(await pathExists(join(projectRoot, "packages/link"))).toBe(true);
		});
	});

	it("keeps user symlinks instead of unlinking them while pruning", async () => {
		await withTempDir("apply-prune-symlink", async (directory) => {
			const removedFile = "packages/db/index.ts";
			const content = "export {};\n";

			await mkdir(join(directory, "packages/real-db"), { recursive: true });
			await symlink(
				join(directory, "packages/real-db"),
				join(directory, "packages/db"),
			);
			await writeText(join(directory, removedFile), content);

			await Effect.runPromise(
				State.writeLockfile(directory, {
					artifacts: {
						[`project:file:${removedFile}`]: {
							definitionIds: ["drizzle"],
							hash: await hashContent(content),
							kind: "file",
							path: removedFile,
						},
					},
				}).pipe(Effect.provide(coreLayer)),
			);

			await Effect.runPromise(
				Apply.applyPlan(directory, {
					lockfile: { artifacts: {} },
					manifest: { config: {}, installs: [], modules: {} },
					removals: [removedFile],
					writes: [],
				}).pipe(Effect.provide(coreLayer)),
			);

			expect(await pathExists(join(directory, "packages/db"))).toBe(true);
			expect(await pathExists(join(directory, "packages/real-db"))).toBe(true);
		});
	});

	it("does not prune directories for removals that were already gone", async () => {
		await withTempDir("apply-prune-missing", async (directory) => {
			const missingFile = "packages/db/src/index.ts";

			await mkdir(join(directory, "packages/db/src"), { recursive: true });

			await Effect.runPromise(
				State.writeLockfile(directory, {
					artifacts: {
						[`project:file:${missingFile}`]: {
							definitionIds: ["drizzle"],
							hash: await hashContent("export {};\n"),
							kind: "file",
							path: missingFile,
						},
					},
				}).pipe(Effect.provide(coreLayer)),
			);

			await Effect.runPromise(
				Apply.applyPlan(directory, {
					lockfile: { artifacts: {} },
					manifest: { config: {}, installs: [], modules: {} },
					removals: [missingFile],
					writes: [],
				}).pipe(Effect.provide(coreLayer)),
			);

			expect(await pathExists(join(directory, "packages/db/src"))).toBe(true);
		});
	});

	it("accepts a renamed module's leaf file via the previous manifest root", async () => {
		await withTempDir("apply-renamed-leaf", async (directory) => {
			await writeText(
				`${directory}/packages/observability/src/logs.ts`,
				"old-managed\n",
			);

			await Effect.runPromise(
				State.writeManifest(directory, {
					config: {},
					installs: [{ definitionId: "logs", targets: [{ kind: "project" }] }],
					modules: {
						abcde: {
							definitionIds: ["logs"],
							root: "packages/telemetry",
						},
					},
				}).pipe(Effect.provide(coreLayer)),
			);

			await Effect.runPromise(
				State.writeLockfile(directory, {
					artifacts: {
						"module:abcde:file:packages/telemetry/src/logs.ts": {
							definitionIds: ["logs"],
							hash: await hashContent("old-managed\n"),
							kind: "file",
							path: "packages/telemetry/src/logs.ts",
						},
					},
				}).pipe(Effect.provide(coreLayer)),
			);

			await Effect.runPromise(
				Apply.applyPlan(directory, {
					lockfile: { artifacts: {} },
					manifest: {
						config: {},
						installs: [
							{ definitionId: "logs", targets: [{ kind: "project" }] },
						],
						modules: {
							abcde: {
								definitionIds: ["logs"],
								root: "packages/observability",
							},
						},
					},
					removals: [],
					writes: [
						{
							artifactId:
								"module:abcde:file:packages/observability/src/logs.ts",
							content: "new-managed\n",
							path: "packages/observability/src/logs.ts",
						},
					],
				}).pipe(Effect.provide(coreLayer)),
			);

			expect(
				await readFile(
					`${directory}/packages/observability/src/logs.ts`,
					"utf-8",
				),
			).toBe("new-managed\n");
		});
	});

	it("keeps rejecting unmanaged files when the module root is unchanged", async () => {
		await withTempDir("apply-unmanaged-leaf", async (directory) => {
			await writeText(
				`${directory}/packages/telemetry/src/logs.ts`,
				"old-managed\n",
			);

			await Effect.runPromise(
				State.writeManifest(directory, {
					config: {},
					installs: [{ definitionId: "logs", targets: [{ kind: "project" }] }],
					modules: {
						abcde: {
							definitionIds: ["logs"],
							root: "packages/telemetry",
						},
					},
				}).pipe(Effect.provide(coreLayer)),
			);

			const error = await Effect.runPromise(
				Effect.flip(
					Apply.applyPlan(directory, {
						lockfile: { artifacts: {} },
						manifest: {
							config: {},
							installs: [
								{ definitionId: "logs", targets: [{ kind: "project" }] },
							],
							modules: {
								abcde: {
									definitionIds: ["logs"],
									root: "packages/telemetry",
								},
							},
						},
						removals: [],
						writes: [
							{
								artifactId: "module:abcde:file:packages/telemetry/src/logs.ts",
								content: "new-managed\n",
								path: "packages/telemetry/src/logs.ts",
							},
						],
					}).pipe(Effect.provide(coreLayer)),
				),
			);

			expect(error).toMatchObject({
				_tag: "ApplyError",
				message: "Unmanaged File Exists",
				path: "packages/telemetry/src/logs.ts",
			});
		});
	});
});
