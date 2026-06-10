import { mkdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { NodeContext } from "@effect/platform-node";
import { Cause, Effect, Exit, Layer, Option } from "effect";
import { describe, expect, it } from "vitest";
import { Apply, type ApplyError, CoreLive, State } from "../src/index";
import { withTempDir, writeText } from "./harness";

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

			await Effect.runPromise(
				State.writeLockfile(directory, {
					artifacts: {
						"project:file:apps/web/app/layout.tsx": {
							definitionIds: ["nextjs/base"],
							hash: await hashContent("old-managed\n"),
							kind: "file",
							path: "apps/web/app/layout.tsx",
						},
					},
				}).pipe(Effect.provide(coreLayer)),
			);

			await expect(
				Effect.runPromiseExit(
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
			).resolves.toSatisfy((exit) => {
				if (!Exit.isFailure(exit)) return false;

				const failure = Cause.failureOption(exit.cause);
				if (Option.isNone(failure)) return false;

				const error = failure.value as ApplyError;

				return (
					error._tag === "ApplyError" &&
					error.message === "Managed File Modified"
				);
			});

			expect(
				await readFile(`${directory}/apps/web/app/layout.tsx`, "utf-8"),
			).toBe("user-change\n");
		});
	});

	it("refuses to remove a modified managed file", async () => {
		await withTempDir("apply-remove", async (directory) => {
			await writeText(`${directory}/packages/ui/forge.json`, "{\n}\n");

			await Effect.runPromise(
				State.writeLockfile(directory, {
					artifacts: {
						"project:file:packages/ui/forge.json": {
							definitionIds: ["ui"],
							hash: await hashContent('{\n\t"old": true\n}\n'),
							kind: "file",
							path: "packages/ui/forge.json",
						},
					},
				}).pipe(Effect.provide(coreLayer)),
			);

			await expect(
				Effect.runPromiseExit(
					Apply.applyPlan(directory, {
						lockfile: { artifacts: {} },
						manifest: { config: {}, installs: [], modules: {} },
						removals: ["packages/ui/forge.json"],
						writes: [],
					}).pipe(Effect.provide(coreLayer)),
				),
			).resolves.toSatisfy((exit) => {
				if (!Exit.isFailure(exit)) return false;

				const failure = Cause.failureOption(exit.cause);
				if (Option.isNone(failure)) return false;

				const error = failure.value as ApplyError;

				return (
					error._tag === "ApplyError" &&
					error.message === "Managed File Modified"
				);
			});

			expect(
				await readFile(`${directory}/packages/ui/forge.json`, "utf-8"),
			).toBe("{\n}\n");
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
			expect(await pathExists(directory)).toBe(true);
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
});
