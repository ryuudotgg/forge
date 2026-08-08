import { mkdir, readdir, readFile, rename } from "node:fs/promises";
import { join } from "node:path";
import { FileSystem, Error as PlatformError } from "@effect/platform";
import { NodeContext, NodeFileSystem } from "@effect/platform-node";
import { Effect, Layer, Schema } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	buildArtifactIndex,
	ConfigStore,
	CoreLive,
	type Lockfile,
	LockfileSchema,
	type Manifest,
	ManifestSchema,
	State,
	StateErrors,
} from "../src/index";
import {
	hashContent,
	readJson,
	withTempDir,
	writeJson,
	writeText,
} from "./harness";

const projectLayer = CoreLive.pipe(Layer.provideMerge(NodeContext.layer));

async function stateLayerWithFileSystem(
	transform: (fileSystem: FileSystem.FileSystem) => FileSystem.FileSystem,
) {
	const fileSystem = await Effect.runPromise(
		FileSystem.FileSystem.pipe(Effect.provide(NodeFileSystem.layer)),
	);
	const fileSystemLayer = Layer.succeed(
		FileSystem.FileSystem,
		transform(fileSystem),
	);

	return State.Default.pipe(Layer.provide(fileSystemLayer));
}

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
				schemaVersion: 1,
				config: { slug: "acme" },
				installs: [{ definitionId: "root", targets: [{ kind: "project" }] }],
				modules: {
					abcde: { definitionIds: ["nextjs/base"], root: "apps/web" },
				},
			};

			const lockfile: Lockfile = {
				schemaVersion: 1,
				artifacts: {
					"project:surface:rootPackageJson": {
						base: {
							hash: "abc",
							mergeKind: "json",
							semanticsVersion: 1,
						},
						definitionIds: ["root"],
						hash: "abc",
						kind: "surface",
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

	it("round-trips content-addressed bases and garbage collects unreferenced blobs", async () => {
		await withTempDir("state-bases", async (directory) => {
			const keptHash = await hashContent("pure render\n");
			const removedHash = await hashContent("obsolete\n");
			await Effect.runPromise(
				Effect.gen(function* () {
					yield* State.writeBase(directory, keptHash, "pure render\n");
					yield* State.writeBase(directory, keptHash, "pure render\n");
					yield* State.writeBase(directory, removedHash, "obsolete\n");
				}).pipe(Effect.provide(projectLayer)),
			);

			expect(
				await Effect.runPromise(
					State.readBase(directory, keptHash).pipe(
						Effect.provide(projectLayer),
					),
				),
			).toBe("pure render\n");

			const lockfile: Lockfile = {
				schemaVersion: 1,
				artifacts: {
					"project:surface:rootPackageJson": {
						base: {
							hash: keptHash,
							mergeKind: "json",
							semanticsVersion: 1,
						},
						definitionIds: ["root"],
						hash: keptHash,
						kind: "surface",
						path: "package.json",
					},
					"project:file:opaque": {
						base: {
							hash: keptHash,
							mergeKind: "opaque",
							semanticsVersion: 1,
						},
						definitionIds: ["root"],
						hash: "user-content",
						kind: "file",
						path: "opaque.txt",
					},
				},
			};
			await Effect.runPromise(
				State.garbageCollectBases(directory, lockfile).pipe(
					Effect.provide(projectLayer),
				),
			);

			expect(await readdir(join(directory, ".forge/bases"))).toEqual([
				keptHash,
			]);
			expect(
				await readFile(join(directory, ".forge/bases", keptHash), "utf-8"),
			).toBe("pure render\n");
		});
	});

	it("rejects base blobs whose content does not match their address", async () => {
		await withTempDir("state-base-integrity", async (directory) => {
			const hash = await hashContent("pure render\n");
			await Effect.runPromise(
				State.writeBase(directory, hash, "pure render\n").pipe(
					Effect.provide(projectLayer),
				),
			);
			await writeText(join(directory, ".forge/bases", hash), "corrupt\n");
			const error = await Effect.runPromise(
				Effect.flip(
					State.readBase(directory, hash).pipe(Effect.provide(projectLayer)),
				),
			);
			expect(error).toMatchObject({ message: "Base Hash Mismatch" });
		});
	});

	it("maps state bundle existence failures with the original cause", async () => {
		await withTempDir("state-bundle-exists-failure", async (directory) => {
			const path = join(directory, ".forge/state.json");
			const cause = new PlatformError.SystemError({
				method: "exists",
				module: "FileSystem",
				pathOrDescriptor: path,
				reason: "PermissionDenied",
			});
			const failingLayer = await stateLayerWithFileSystem((fileSystem) => ({
				...fileSystem,
				exists: (target) =>
					target === path ? Effect.fail(cause) : fileSystem.exists(target),
			}));

			const error = await Effect.runPromise(
				Effect.flip(
					State.readStateBundle(directory).pipe(Effect.provide(failingLayer)),
				),
			);

			expect(error._tag).toBe("StateError");
			if (error._tag !== "StateError") throw new Error("Expected State Error");
			expect(error.filePath).toBe(path);
			expect(error.reason).toBe("state-bundle-read-failed");
			expect(error.message).toBe("State Bundle Read Failed");
			expect(error.cause).toMatchObject({
				_tag: "SystemError",
				method: "exists",
				pathOrDescriptor: path,
				reason: "PermissionDenied",
			});
		});
	});

	it("maps manifest default existence failures with the original cause", async () => {
		await withTempDir("manifest-default-exists-failure", async (directory) => {
			const path = join(directory, ".forge/manifest.json");
			const cause = new PlatformError.SystemError({
				method: "exists",
				module: "FileSystem",
				pathOrDescriptor: path,
				reason: "PermissionDenied",
			});
			const failingLayer = await stateLayerWithFileSystem((fileSystem) => ({
				...fileSystem,
				exists: (target) =>
					target === path ? Effect.fail(cause) : fileSystem.exists(target),
			}));

			const error = await Effect.runPromise(
				Effect.flip(
					State.readManifestOrDefault(directory).pipe(
						Effect.provide(failingLayer),
					),
				),
			);

			expect(error._tag).toBe("StateError");
			if (error._tag !== "StateError") throw new Error("Expected State Error");
			expect(error.filePath).toBe(path);
			expect(error.reason).toBe("manifest-read-failed");
			expect(error.message).toBe("Manifest Read Failed");
			expect(error.cause).toMatchObject({
				_tag: "SystemError",
				method: "exists",
				pathOrDescriptor: path,
				reason: "PermissionDenied",
			});
		});
	});

	it("maps manifest existence failures with the original cause", async () => {
		await withTempDir("manifest-exists-failure", async (directory) => {
			const path = join(directory, ".forge/manifest.json");
			const cause = new PlatformError.SystemError({
				method: "exists",
				module: "FileSystem",
				pathOrDescriptor: path,
				reason: "PermissionDenied",
			});
			const failingLayer = await stateLayerWithFileSystem((fileSystem) => ({
				...fileSystem,
				exists: (target) =>
					target === path ? Effect.fail(cause) : Effect.succeed(false),
			}));

			const error = await Effect.runPromise(
				Effect.flip(
					State.readManifest(directory).pipe(Effect.provide(failingLayer)),
				),
			);

			expect(error._tag).toBe("StateError");
			if (error._tag !== "StateError") throw new Error("Expected State Error");
			expect(error.filePath).toBe(path);
			expect(error.reason).toBe("manifest-read-failed");
			expect(error.message).toBe("Manifest Read Failed");
			expect(error.cause).toMatchObject({
				_tag: "SystemError",
				method: "exists",
				pathOrDescriptor: path,
				reason: "PermissionDenied",
			});
		});
	});

	it("maps lockfile existence failures with the original cause", async () => {
		await withTempDir("lockfile-exists-failure", async (directory) => {
			const path = join(directory, ".forge/lock.json");
			const cause = new PlatformError.SystemError({
				method: "exists",
				module: "FileSystem",
				pathOrDescriptor: path,
				reason: "PermissionDenied",
			});
			const failingLayer = await stateLayerWithFileSystem((fileSystem) => ({
				...fileSystem,
				exists: (target) =>
					target === path ? Effect.fail(cause) : Effect.succeed(false),
			}));

			const error = await Effect.runPromise(
				Effect.flip(
					State.readLockfile(directory).pipe(Effect.provide(failingLayer)),
				),
			);

			expect(error._tag).toBe("StateError");
			if (error._tag !== "StateError") throw new Error("Expected State Error");
			expect(error.filePath).toBe(path);
			expect(error.reason).toBe("lockfile-read-failed");
			expect(error.message).toBe("Lockfile Read Failed");
			expect(error.cause).toMatchObject({
				_tag: "SystemError",
				method: "exists",
				pathOrDescriptor: path,
				reason: "PermissionDenied",
			});
		});
	});

	it("maps base hashing failures with the original cause", async () => {
		await withTempDir("state-base-hash-failure", async (directory) => {
			const cause = new Error("digest failed");
			vi.spyOn(globalThis.crypto.subtle, "digest").mockRejectedValueOnce(cause);

			const error = await Effect.runPromise(
				Effect.flip(
					State.writeBase(directory, "a".repeat(64), "content").pipe(
						Effect.provide(projectLayer),
					),
				),
			);

			expect(error._tag).toBe("StateError");
			if (error._tag !== "StateError") throw new Error("Expected State Error");
			expect(error.reason).toBe("base-hash-failed");
			expect(error.message).toBe("Base Hash Failed");
			expect(error.cause).toBe(cause);
		});
	});

	it("maps base write failures with the original cause", async () => {
		await withTempDir("state-base-write-failure", async (directory) => {
			const content = "pure render\n";
			const hash = await hashContent(content);
			const path = join(directory, ".forge/bases", hash);
			const cause = new PlatformError.SystemError({
				method: "writeFileString",
				module: "FileSystem",
				pathOrDescriptor: path,
				reason: "PermissionDenied",
			});
			const failingLayer = await stateLayerWithFileSystem((fileSystem) => ({
				...fileSystem,
				writeFileString: () => Effect.fail(cause),
			}));

			const error = await Effect.runPromise(
				Effect.flip(
					State.writeBase(directory, hash, content).pipe(
						Effect.provide(failingLayer),
					),
				),
			);

			expect(error._tag).toBe("StateError");
			if (error._tag !== "StateError") throw new Error("Expected State Error");
			expect(Schema.is(StateErrors)(error)).toBe(true);
			expect(error.reason).toBe("base-write-failed");
			expect(error.message).toBe("Base Write Failed");
			expect(error.cause).toMatchObject({
				_tag: "SystemError",
				method: "writeFileString",
				pathOrDescriptor: path,
			});
		});
	});

	it("maps base existence failures with the original cause", async () => {
		await withTempDir("state-base-exists-failure", async (directory) => {
			const content = "pure render\n";
			const hash = await hashContent(content);
			const path = join(directory, ".forge/bases", hash);
			const cause = new PlatformError.SystemError({
				method: "exists",
				module: "FileSystem",
				pathOrDescriptor: path,
				reason: "PermissionDenied",
			});
			const failingLayer = await stateLayerWithFileSystem((fileSystem) => ({
				...fileSystem,
				exists: (target) =>
					target === path ? Effect.fail(cause) : fileSystem.exists(target),
			}));

			const error = await Effect.runPromise(
				Effect.flip(
					State.writeBase(directory, hash, content).pipe(
						Effect.provide(failingLayer),
					),
				),
			);

			expect(error._tag).toBe("StateError");
			if (error._tag !== "StateError") throw new Error("Expected State Error");
			expect(error.filePath).toBe(path);
			expect(error.reason).toBe("base-read-failed");
			expect(error.message).toBe("Base Read Failed");
			expect(error.cause).toMatchObject({
				_tag: "SystemError",
				method: "exists",
				pathOrDescriptor: path,
				reason: "PermissionDenied",
			});
		});
	});

	it("maps base directory existence failures with the original cause", async () => {
		await withTempDir("bases-exists-failure", async (directory) => {
			const path = join(directory, ".forge/bases");
			const cause = new PlatformError.SystemError({
				method: "exists",
				module: "FileSystem",
				pathOrDescriptor: path,
				reason: "PermissionDenied",
			});
			const failingLayer = await stateLayerWithFileSystem((fileSystem) => ({
				...fileSystem,
				exists: (target) =>
					target === path ? Effect.fail(cause) : Effect.succeed(false),
			}));

			const error = await Effect.runPromise(
				Effect.flip(
					State.garbageCollectBases(directory, { artifacts: {} }).pipe(
						Effect.provide(failingLayer),
					),
				),
			);

			expect(error._tag).toBe("StateError");
			if (error._tag !== "StateError") throw new Error("Expected State Error");
			expect(error.filePath).toBe(path);
			expect(error.reason).toBe("base-directory-read-failed");
			expect(error.message).toBe("Base Directory Read Failed");
			expect(error.cause).toMatchObject({
				_tag: "SystemError",
				method: "exists",
				pathOrDescriptor: path,
				reason: "PermissionDenied",
			});
		});
	});

	it.each([
		[
			"state bundle",
			".forge/state.json",
			"state-bundle-read-failed",
			"State Bundle Read Failed",
		],
		[
			"lockfile",
			".forge/lock.json",
			"lockfile-read-failed",
			"Lockfile Read Failed",
		],
		[
			"manifest",
			".forge/manifest.json",
			"manifest-read-failed",
			"Manifest Read Failed",
		],
	] satisfies ReadonlyArray<
		readonly [string, string, StateErrors["reason"], string]
	>)(
		"maps managed-project $0 existence failures with the original cause",
		async (_label, relativePath, reason, message) => {
			await withTempDir("managed-project-exists-failure", async (directory) => {
				const path = join(directory, relativePath);
				const cause = new PlatformError.SystemError({
					method: "exists",
					module: "FileSystem",
					pathOrDescriptor: path,
					reason: "PermissionDenied",
				});
				const failingLayer = await stateLayerWithFileSystem((fileSystem) => ({
					...fileSystem,
					exists: (target) =>
						target === path ? Effect.fail(cause) : Effect.succeed(false),
				}));

				const error = await Effect.runPromise(
					Effect.flip(
						State.isManagedProject(directory).pipe(
							Effect.provide(failingLayer),
						),
					),
				);

				expect(error._tag).toBe("StateError");
				if (error._tag !== "StateError")
					throw new Error("Expected State Error");
				expect(error.filePath).toBe(path);
				expect(error.reason).toBe(reason);
				expect(error.message).toBe(message);
				expect(error.cause).toMatchObject({
					_tag: "SystemError",
					method: "exists",
					pathOrDescriptor: path,
					reason: "PermissionDenied",
				});
			});
		},
	);

	it("fails to read a corrupt manifest", async () => {
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

			const fallbackError = await Effect.runPromise(
				Effect.flip(
					State.readManifestOrDefault(directory).pipe(
						Effect.provide(projectLayer),
					),
				),
			);

			expect(fallbackError).toMatchObject({
				_tag: "StateError",
				filePath: join(directory, ".forge/manifest.json"),
			});
			expect(fallbackError.message).toMatch(/^Manifest Parse Failed: /);
		});
	});

	it("preserves the original file system cause", async () => {
		await withTempDir("manifest-read-cause", async (directory) => {
			const path = join(directory, ".forge/manifest.json");
			await mkdir(path, { recursive: true });

			const error = await Effect.runPromise(
				Effect.flip(
					State.readManifest(directory).pipe(Effect.provide(projectLayer)),
				),
			);

			expect(error._tag).toBe("StateError");
			if (error._tag !== "StateError") throw new Error("Expected State Error");
			expect(error.reason).toBe("manifest-read-failed");
			expect(error.message).toBe("Manifest Read Failed");
			expect(error.cause).toMatchObject({
				_tag: "SystemError",
				pathOrDescriptor: path,
			});
		});
	});

	it("round-trips registry opt-in and descriptors", async () => {
		await withTempDir("state-registries", async (directory) => {
			const manifest: Manifest = {
				config: {},
				installs: [],
				modules: {},
				registries: ["@acme/forge-sentry"],
				registryDescriptors: [
					{
						apiVersion: 1,
						id: "@acme/forge-sentry",
						integrity: "sha512-fixture",
						source: "npm",
						units: [{ id: "@acme/sentry", kind: "addon" }],
						version: "2.3.4",
					},
				],
				schemaVersion: 1,
			};

			await Effect.runPromise(
				State.writeManifest(directory, manifest).pipe(
					Effect.provide(projectLayer),
				),
			);

			expect(
				await Effect.runPromise(
					State.readManifest(directory).pipe(Effect.provide(projectLayer)),
				),
			).toEqual(manifest);
		});
	});

	it("encodes current manifest and lockfile schemas", () => {
		const manifest = Schema.encodeSync(ManifestSchema)({
			config: {},
			installs: [],
			modules: { abcde: { definitionIds: [] } },
			registries: ["@acme/forge-sentry"],
			registryDescriptors: [],
			schemaVersion: 1,
		});
		const lockfile = Schema.encodeSync(LockfileSchema)({
			artifacts: {},
			schemaVersion: 1,
		});

		expect(manifest).toEqual({
			config: {},
			installs: [],
			modules: { abcde: { definitionIds: [] } },
			registries: ["@acme/forge-sentry"],
			registryDescriptors: [],
			schemaVersion: 1,
		});
		expect(lockfile).toEqual({ artifacts: {}, schemaVersion: 1 });
	});

	it("rejects invalid registry package names", async () => {
		await withTempDir("state-invalid-registry", async (directory) => {
			await writeJson(join(directory, ".forge/manifest.json"), {
				modules: {},
				registries: ["unscoped"],
				schemaVersion: 1,
			});

			const error = await Effect.runPromise(
				Effect.flip(
					State.readManifest(directory).pipe(Effect.provide(projectLayer)),
				),
			);
			expect(error.message).toMatch(/^Invalid Manifest\n/);
		});
	});

	it("rejects a manifest with invalid field values", async () => {
		await withTempDir("manifest-invalid", async (directory) => {
			await writeJson(join(directory, ".forge/manifest.json"), {
				schemaVersion: 1,
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

			const fallbackError = await Effect.runPromise(
				Effect.flip(
					State.readManifestOrDefault(directory).pipe(
						Effect.provide(projectLayer),
					),
				),
			);

			expect(fallbackError).toMatchObject({ _tag: "StateError" });
			expect(fallbackError.message).toMatch(/^Invalid Manifest\n/);
		});
	});

	it("rejects missing and unsupported state schema versions", async () => {
		await withTempDir("state-schema-version", async (directory) => {
			const versionMessage =
				"We can't read this project's metadata because it was saved by a different version of Forge.";

			for (const schemaVersion of [undefined, "garbage", 2]) {
				await writeJson(join(directory, ".forge/manifest.json"), {
					modules: {},
					schemaVersion,
				});
				const manifestError = await Effect.runPromise(
					Effect.flip(
						State.readManifest(directory).pipe(Effect.provide(projectLayer)),
					),
				);
				expect(manifestError.message).toContain(versionMessage);

				await writeJson(join(directory, ".forge/lock.json"), {
					artifacts: {},
					schemaVersion,
				});
				const lockfileError = await Effect.runPromise(
					Effect.flip(
						State.readLockfile(directory).pipe(Effect.provide(projectLayer)),
					),
				);
				expect(lockfileError.message).toContain(versionMessage);
			}
		});
	});

	it("drops manifest module keys that fail id validation", async () => {
		await withTempDir("manifest-bad-key", async (directory) => {
			await writeJson(join(directory, ".forge/manifest.json"), {
				schemaVersion: 1,
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

			const manifest = await Effect.runPromise(
				State.readManifestOrDefault(directory).pipe(
					Effect.provide(projectLayer),
				),
			);

			expect(manifest).toEqual({
				config: {},
				installs: [],
				modules: {},
				schemaVersion: 1,
			});

			const lockfile = await Effect.runPromise(
				State.readLockfile(directory).pipe(Effect.provide(projectLayer)),
			);

			expect(lockfile).toEqual({ artifacts: {}, schemaVersion: 1 });
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
			schemaVersion: 1,
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
	});
});
