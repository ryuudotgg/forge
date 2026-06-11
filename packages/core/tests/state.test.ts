import { rename } from "node:fs/promises";
import { join } from "node:path";
import { NodeContext } from "@effect/platform-node";
import { Effect, Layer } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	buildArtifactIndex,
	ConfigStore,
	CoreLive,
	type Lockfile,
	type Manifest,
	State,
} from "../src/index";
import { readJson, withTempDir, writeJson, writeText } from "./harness";

const projectLayer = CoreLive.pipe(Layer.provideMerge(NodeContext.layer));

function isManaged(directory: string) {
	return Effect.runPromise(
		State.isManagedProject(directory).pipe(Effect.provide(projectLayer)),
	);
}

type RandomValuesTarget = Parameters<typeof crypto.getRandomValues>[0];

function fillModuleId(letterIndex: number) {
	return <T extends RandomValuesTarget>(array: T): T => {
		if (array instanceof Uint32Array) array.fill(letterIndex);
		return array;
	};
}

describe("project state", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

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

	it("retries module id generation when an id collides", async () => {
		const spy = vi.spyOn(crypto, "getRandomValues");
		spy.mockImplementationOnce(fillModuleId(0));
		spy.mockImplementationOnce(fillModuleId(1));

		const id = await Effect.runPromise(
			ConfigStore.generateId(new Set(["aaaaa"])).pipe(
				Effect.provide(projectLayer),
			),
		);

		expect(id).toBe("bbbbb");
		expect(spy).toHaveBeenCalledTimes(2);
	});

	it("fails module id generation after exhausting attempts", async () => {
		const spy = vi
			.spyOn(crypto, "getRandomValues")
			.mockImplementation(fillModuleId(0));

		const error = await Effect.runPromise(
			Effect.flip(
				ConfigStore.generateId(new Set(["aaaaa"])).pipe(
					Effect.provide(projectLayer),
				),
			),
		);

		expect(error).toMatchObject({
			_tag: "ModuleIdGenerationError",
			message: "Module Id Generation Failed",
		});

		expect(spy).toHaveBeenCalledTimes(32);
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
			expect(first[0]).toEqual({
				id: "qmkta",
				type: "app",
				framework: "nextjs",
				template: { id: "base", version: 1 },
				slots: { layout: "app/layout.tsx" },
				packageName: "@acme/web",
				root: "apps/web",
			});

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

	it("fails to read a corrupt manifest and falls back to the default", async () => {
		await withTempDir("manifest-corrupt", async (directory) => {
			await writeText(join(directory, ".forge/manifest.json"), "{broken");

			const error = await Effect.runPromise(
				Effect.flip(
					State.readManifest(directory).pipe(Effect.provide(projectLayer)),
				),
			);

			expect(error).toMatchObject({
				_tag: "StateError",
				filePath: join(directory, ".forge/manifest.json"),
			});
			expect(error.message).toMatch(/^Manifest Parse Failed: /);

			const fallback = await Effect.runPromise(
				State.readManifestOrDefault(directory).pipe(
					Effect.provide(projectLayer),
				),
			);

			expect(fallback).toEqual({ config: {}, installs: [], modules: {} });
		});
	});

	it("rejects a manifest with invalid field values", async () => {
		await withTempDir("manifest-invalid", async (directory) => {
			await writeJson(join(directory, ".forge/manifest.json"), {
				modules: { abcde: { definitionIds: "nextjs/base" } },
			});

			const error = await Effect.runPromise(
				Effect.flip(
					State.readManifest(directory).pipe(Effect.provide(projectLayer)),
				),
			);

			const [head, ...issues] = error.message.split("\n");

			expect(error._tag).toBe("StateError");
			expect(head).toBe("Invalid Manifest");
			expect(issues.length).toBeGreaterThan(0);
			for (const issue of issues) expect(issue).toMatch(/^ {2}\S/);
		});
	});

	it("drops manifest module keys that fail id validation", async () => {
		await withTempDir("manifest-bad-key", async (directory) => {
			await writeJson(join(directory, ".forge/manifest.json"), {
				modules: { TOOLONG: { definitionIds: ["nextjs/base"] } },
			});

			const manifest = await Effect.runPromise(
				State.readManifest(directory).pipe(Effect.provide(projectLayer)),
			);

			expect(manifest.modules).toEqual({});
		});
	});

	it("fails to read a corrupt lockfile instead of defaulting", async () => {
		await withTempDir("lockfile-corrupt", async (directory) => {
			await writeText(join(directory, ".forge/lock.json"), "{broken");

			const error = await Effect.runPromise(
				Effect.flip(
					State.readLockfile(directory).pipe(Effect.provide(projectLayer)),
				),
			);

			expect(error).toMatchObject({
				_tag: "StateError",
				filePath: join(directory, ".forge/lock.json"),
			});
			expect(error.message).toMatch(/^Lockfile Parse Failed: /);
		});
	});

	it("reports a missing manifest but defaults a missing lockfile", async () => {
		await withTempDir("state-missing", async (directory) => {
			const error = await Effect.runPromise(
				Effect.flip(
					State.readManifest(directory).pipe(Effect.provide(projectLayer)),
				),
			);

			expect(error).toMatchObject({
				_tag: "StateError",
				message: "Manifest Not Found",
			});

			const lockfile = await Effect.runPromise(
				State.readLockfile(directory).pipe(Effect.provide(projectLayer)),
			);

			expect(lockfile).toEqual({ artifacts: {} });
		});
	});

	it("treats lockfile-only projects as managed", async () => {
		await withTempDir("lockfile-only", async (directory) => {
			expect(await isManaged(directory)).toBe(false);

			await Effect.runPromise(
				State.writeLockfile(directory, { artifacts: {} }).pipe(
					Effect.provide(projectLayer),
				),
			);

			expect(await isManaged(directory)).toBe(true);
		});
	});

	it("treats manifest-only projects as managed", async () => {
		await withTempDir("manifest-only", async (directory) => {
			await Effect.runPromise(
				State.writeManifest(directory, {
					config: {},
					installs: [],
					modules: {},
				}).pipe(Effect.provide(projectLayer)),
			);

			expect(await isManaged(directory)).toBe(true);
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
				"project:file:tsconfig.json": {
					definitionIds: ["root"],
					hash: "def",
					kind: "file",
					path: "tsconfig.json",
				},
				"project:file:biome.json": {
					definitionIds: ["lint", "format"],
					hash: "ghi",
					kind: "file",
					path: "biome.json",
				},
			},
		});

		expect(index.byId.get("project:file:package.json")?.path).toBe(
			"package.json",
		);

		expect(index.byPath.get("tsconfig.json")?.hash).toBe("def");

		expect(
			index.byDefinition.get("root")?.map((artifact) => artifact.path),
		).toEqual(["package.json", "tsconfig.json"]);

		expect(
			index.byDefinition.get("lint")?.map((artifact) => artifact.path),
		).toEqual(["biome.json"]);

		expect(
			index.byDefinition.get("format")?.map((artifact) => artifact.path),
		).toEqual(["biome.json"]);
	});
});
