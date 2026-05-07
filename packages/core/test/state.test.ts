import { rename } from "node:fs/promises";
import { join } from "node:path";
import { NodeContext } from "@effect/platform-node";
import { Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";
import {
	buildArtifactIndex,
	ConfigStore,
	CoreLive,
	type Lockfile,
	type Manifest,
	State,
} from "../src/index";
import { readJson, withTempDir, writeJson } from "./harness";

const projectLayer = CoreLive.pipe(Layer.provideMerge(NodeContext.layer));

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

	it("writes and reads manifest and lockfile", async () => {
		await withTempDir("state", async (directory) => {
			const manifest: Manifest = {
				config: { slug: "acme" },
				installs: [{ definitionId: "root", targets: [{ kind: "project" }] }],
				modules: {
					abcde: { definitionIds: ["nextjs/base"], root: "apps/web" },
				},
			};

			const lockfile: Lockfile = {
				artifacts: {
					"project:file:package.json": {
						definitionIds: ["root"],
						hash: "abc",
						kind: "file",
						path: "package.json",
					},
				},
			};

			await Effect.runPromise(
				State.writeManifest(directory, manifest).pipe(
					Effect.provide(projectLayer),
				),
			);

			await Effect.runPromise(
				State.writeLockfile(directory, lockfile).pipe(
					Effect.provide(projectLayer),
				),
			);

			const readManifest = await Effect.runPromise(
				State.readManifest(directory).pipe(Effect.provide(projectLayer)),
			);

			const readLockfile = await Effect.runPromise(
				State.readLockfile(directory).pipe(Effect.provide(projectLayer)),
			);

			expect(readManifest).toEqual(manifest);
			expect(readLockfile).toEqual(lockfile);

			expect(await readJson(join(directory, ".forge/manifest.json"))).toEqual(
				manifest,
			);

			expect(await readJson(join(directory, ".forge/lock.json"))).toEqual(
				lockfile,
			);
		});
	});

	it("indexes artifacts by id, path, and definition", () => {
		const index = buildArtifactIndex({
			artifacts: {
				"project:file:package.json": {
					definitionIds: ["root"],
					hash: "abc",
					kind: "file",
					path: "package.json",
				},
			},
		});

		expect(index.byId.get("project:file:package.json")?.path).toBe(
			"package.json",
		);

		expect(index.byPath.get("package.json")?.hash).toBe("abc");
		expect(index.byDefinition.get("root")?.[0]?.path).toBe("package.json");
	});
});
