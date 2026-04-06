import { rename } from "node:fs/promises";
import { join } from "node:path";
import { NodeContext } from "@effect/platform-node";
import { Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";
import { ConfigStore, type Lockfile, type Manifest, State } from "../src/index";
import { readJson, withTempDir, writeJson } from "./harness";

const projectLayer = Layer.mergeAll(ConfigStore.Default, State.Default).pipe(
	Layer.provideMerge(NodeContext.layer),
);

describe("project state", () => {
	it("generates opaque alphabetic module ids", async () => {
		const id = await Effect.runPromise(
			ConfigStore.generateId(new Set(["aaaaa", "bbbbb"])).pipe(
				Effect.provide(projectLayer),
			),
		);

		expect(id).toMatch(/^[a-z]{5}$/);
		expect(id).not.toBe("aaaaa");
		expect(id).not.toBe("bbbbb");
	});

	it("discovers modules and survives folder/package renames", async () => {
		await withTempDir("discover", async (directory) => {
			const appRoot = join(directory, "apps/web");

			await writeJson(join(appRoot, "forge.json"), {
				id: "qmkta",
				type: "app",
				framework: "nextjs",
				template: { id: "base", version: 1 },
				slots: { layout: "app/layout.tsx" },
			});

			await writeJson(join(appRoot, "package.json"), {
				name: "@acme/web",
			});

			const first = await Effect.runPromise(
				ConfigStore.discover(directory).pipe(Effect.provide(projectLayer)),
			);

			expect(first).toHaveLength(1);
			expect(first[0]?.id).toBe("qmkta");
			expect(first[0]?.packageName).toBe("@acme/web");
			expect(first[0]?.root).toBe("apps/web");

			const renamedRoot = join(directory, "apps/site");

			await rename(appRoot, renamedRoot);
			await writeJson(join(renamedRoot, "package.json"), {
				name: "@acme/site",
			});

			const second = await Effect.runPromise(
				ConfigStore.discover(directory).pipe(Effect.provide(projectLayer)),
			);

			expect(second).toHaveLength(1);
			expect(second[0]?.id).toBe("qmkta");
			expect(second[0]?.packageName).toBe("@acme/site");
			expect(second[0]?.root).toBe("apps/site");
		});
	});

	it("writes and reads project manifest and lockfile", async () => {
		await withTempDir("state", async (directory) => {
			const manifest: Manifest = {
				version: 1,
				modules: { abcde: {} },
				installs: [],
			};
			const lockfile: Lockfile = {
				version: 1,
				resolutions: {},
				provenance: {},
			};

			await Effect.runPromise(
				Effect.gen(function* () {
					yield* State.writeManifest(directory, manifest);
					yield* State.writeLockfile(directory, lockfile);
				}).pipe(Effect.provide(projectLayer)),
			);

			const readBack = await Effect.runPromise(
				Effect.gen(function* () {
					return {
						lockfile: yield* State.readLockfile(directory),
						manifest: yield* State.readManifest(directory),
					};
				}).pipe(Effect.provide(projectLayer)),
			);

			expect(readBack.manifest).toEqual(manifest);
			expect(readBack.lockfile).toEqual(lockfile);

			expect(await readJson(join(directory, ".forge/manifest.json"))).toEqual(
				manifest,
			);

			expect(await readJson(join(directory, ".forge/lock.json"))).toEqual(
				lockfile,
			);
		});
	});
});
