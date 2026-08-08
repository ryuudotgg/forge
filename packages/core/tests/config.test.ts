import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { FileSystem, Error as PlatformError } from "@effect/platform";
import { NodeContext } from "@effect/platform-node";
import { Cause, Effect, Exit, Layer, Option } from "effect";
import { describe, expect, it } from "vitest";
import {
	CommandProbe,
	ConfigStore,
	CoreLive,
	type PackageConfig,
} from "../src/index";
import { withTempDir, writeJson, writeText } from "./harness";

const projectLayer = CoreLive.pipe(Layer.provideMerge(NodeContext.layer));

function systemFailure(method: string, path: string) {
	return Effect.fail(
		new PlatformError.SystemError({
			method,
			module: "FileSystem",
			pathOrDescriptor: path,
			reason: "PermissionDenied",
		}),
	);
}

function badArgumentFailure(method: string) {
	return Effect.fail(
		new PlatformError.BadArgument({
			description: "invalid traversal argument",
			method,
			module: "FileSystem",
		}),
	);
}

function configLayerWithFileSystem(
	transform: (fileSystem: FileSystem.FileSystem) => FileSystem.FileSystem,
) {
	const fileSystemLayer = Layer.effect(
		FileSystem.FileSystem,
		Effect.map(FileSystem.FileSystem, transform),
	).pipe(Layer.provide(NodeContext.layer));

	return CoreLive.pipe(
		Layer.provideMerge(fileSystemLayer),
		Layer.provideMerge(NodeContext.layer),
	);
}

function appConfig(id: string) {
	return {
		id,
		type: "app",
		framework: "nextjs",
		template: { id: "base", version: 1 },
		slots: { layout: "app/layout.tsx" },
	};
}

async function failure<A, E>(effect: Effect.Effect<A, E, never>) {
	const exit = await Effect.runPromiseExit(effect);

	if (!Exit.isFailure(exit)) throw new Error("Expected Effect Failure");

	const failed = Cause.failureOption(exit.cause);
	if (Option.isNone(failed)) throw new Error("Expected Effect Failure");

	return failed.value;
}

describe("module config store", () => {
	it("rejects duplicate module ids during discovery", async () => {
		await withTempDir("config-duplicate", async (directory) => {
			await writeJson(
				join(directory, "apps/web/forge.json"),
				appConfig("aaaaa"),
			);

			await writeJson(
				join(directory, "apps/admin/forge.json"),
				appConfig("aaaaa"),
			);

			const error = await failure(
				ConfigStore.discover(directory).pipe(Effect.provide(projectLayer)),
			);

			expect(error._tag).toBe("DuplicateModuleIdError");
			if (error._tag !== "DuplicateModuleIdError")
				throw new Error("Expected Duplicate Module Id");

			expect(error.moduleId).toBe("aaaaa");
			expect(error.message).toBe("Duplicate Module Id");
			expect([error.firstPath, error.secondPath].sort()).toEqual([
				"apps/admin",
				"apps/web",
			]);
		});
	});

	it("fails to read a module without a forge.json", async () => {
		await withTempDir("config-missing", async (directory) => {
			const error = await failure(
				ConfigStore.read(directory).pipe(Effect.provide(projectLayer)),
			);

			expect(error._tag).toBe("ModuleConfigError");
			if (error._tag !== "ModuleConfigError")
				throw new Error("Expected Module Config Error");

			expect(error.message).toBe("Module Config Not Found");
			expect(error.filePath).toBe(join(directory, "forge.json"));
		});
	});

	it("maps config existence failures with the original cause", async () => {
		await withTempDir("config-exists-failure", async (directory) => {
			const path = join(directory, "forge.json");
			const cause = new PlatformError.SystemError({
				method: "exists",
				module: "FileSystem",
				pathOrDescriptor: path,
				reason: "PermissionDenied",
			});
			const failingLayer = configLayerWithFileSystem((fileSystem) => ({
				...fileSystem,
				exists: (target) =>
					target === path ? Effect.fail(cause) : fileSystem.exists(target),
			}));

			const error = await failure(
				ConfigStore.read(directory).pipe(Effect.provide(failingLayer)),
			);

			expect(error._tag).toBe("ModuleConfigError");
			if (error._tag !== "ModuleConfigError")
				throw new Error("Expected Module Config Error");
			expect(error.filePath).toBe(path);
			expect(error.reason).toBe("read-failed");
			expect(error.message).toBe("Module Config Read Failed");
			expect(error.cause).toMatchObject({
				_tag: "SystemError",
				method: "exists",
				pathOrDescriptor: path,
				reason: "PermissionDenied",
			});
		});
	});

	it("fails to read a forge.json that is not valid json", async () => {
		await withTempDir("config-parse", async (directory) => {
			await writeText(join(directory, "forge.json"), "{not json");

			const error = await failure(
				ConfigStore.read(directory).pipe(Effect.provide(projectLayer)),
			);

			expect(error._tag).toBe("ModuleConfigError");
			if (error._tag !== "ModuleConfigError")
				throw new Error("Expected Module Config Error");

			expect(error.message).toMatch(/^Module Config Parse Failed: /);
		});
	});

	it("fails to read a forge.json that violates the schema", async () => {
		await withTempDir("config-validate", async (directory) => {
			await writeJson(join(directory, "forge.json"), appConfig("ABC"));

			const error = await failure(
				ConfigStore.read(directory).pipe(Effect.provide(projectLayer)),
			);

			expect(error._tag).toBe("ModuleConfigError");
			if (error._tag !== "ModuleConfigError")
				throw new Error("Expected Module Config Error");

			expect(error.message).toMatch(/^Invalid Module Config\n/);
			expect(error.message).toContain(
				'  id: Expected a string matching the pattern ^[a-z]{5}$, actual "ABC"',
			);
		});
	});

	it("discovers modules with a broken package.json without a package name", async () => {
		await withTempDir("config-broken-package", async (directory) => {
			const moduleRoot = join(directory, "apps/web");

			await writeJson(join(moduleRoot, "forge.json"), appConfig("qmkta"));
			await writeText(join(moduleRoot, "package.json"), "{broken");

			const modules = await Effect.runPromise(
				ConfigStore.discover(directory).pipe(Effect.provide(projectLayer)),
			);

			expect(modules).toHaveLength(1);
			expect(modules[0]?.id).toBe("qmkta");
			expect(modules[0]?.root).toBe("apps/web");
			expect(modules[0]?.packageName).toBeUndefined();
		});
	});

	it("treats package.json as absent when its existence check fails", async () => {
		await withTempDir("config-package-exists-failure", async (directory) => {
			const moduleRoot = join(directory, "apps/web");
			const packagePath = join(moduleRoot, "package.json");

			await writeJson(join(moduleRoot, "forge.json"), appConfig("qmkta"));
			await writeJson(packagePath, { name: "@forge/web" });

			const failingLayer = configLayerWithFileSystem((fileSystem) => ({
				...fileSystem,
				exists: (target) =>
					target === packagePath
						? systemFailure("exists", target)
						: fileSystem.exists(target),
			}));
			const modules = await Effect.runPromise(
				ConfigStore.discover(directory).pipe(Effect.provide(failingLayer)),
			);

			expect(modules[0]?.packageName).toBeUndefined();
		});
	});

	it("treats package.json as absent when reading it fails", async () => {
		await withTempDir("config-package-read-failure", async (directory) => {
			const moduleRoot = join(directory, "apps/web");
			const packagePath = join(moduleRoot, "package.json");

			await writeJson(join(moduleRoot, "forge.json"), appConfig("qmkta"));
			await writeJson(packagePath, { name: "@forge/web" });

			const failingLayer = configLayerWithFileSystem((fileSystem) => ({
				...fileSystem,
				readFileString: (target, encoding) =>
					target === packagePath
						? systemFailure("readFileString", target)
						: fileSystem.readFileString(target, encoding),
			}));
			const modules = await Effect.runPromise(
				ConfigStore.discover(directory).pipe(Effect.provide(failingLayer)),
			);

			expect(modules[0]?.packageName).toBeUndefined();
		});
	});

	it("returns no modules when scanning the project root fails", async () => {
		await withTempDir("config-root-read-failure", async (directory) => {
			const failingLayer = configLayerWithFileSystem((fileSystem) => ({
				...fileSystem,
				readDirectory: (target, options) =>
					target === directory
						? systemFailure("readDirectory", target)
						: fileSystem.readDirectory(target, options),
			}));

			const modules = await Effect.runPromise(
				ConfigStore.discover(directory).pipe(Effect.provide(failingLayer)),
			);

			expect(modules).toEqual([]);
		});
	});

	it("surfaces bad traversal arguments as discovery failures", async () => {
		await withTempDir("config-root-bad-argument", async (directory) => {
			const failingLayer = configLayerWithFileSystem((fileSystem) => ({
				...fileSystem,
				readDirectory: (target, options) =>
					target === directory
						? badArgumentFailure("readDirectory")
						: fileSystem.readDirectory(target, options),
			}));

			const error = await failure(
				ConfigStore.discover(directory).pipe(Effect.provide(failingLayer)),
			);

			expect(error._tag).toBe("DiscoveryError");
			expect(error.message).toBe(
				"Module Discovery Failed: BadArgument: FileSystem.readDirectory: invalid traversal argument",
			);
		});
	});

	it("returns discovered modules in root-path order", async () => {
		await withTempDir("config-order", async (directory) => {
			await writeJson(
				join(directory, "packages/zeta/forge.json"),
				appConfig("zzzzz"),
			);
			await writeJson(
				join(directory, "apps/alpha/forge.json"),
				appConfig("aaaaa"),
			);

			const modules = await Effect.runPromise(
				ConfigStore.discover(directory).pipe(Effect.provide(projectLayer)),
			);

			expect(modules.map((module) => module.root)).toEqual([
				"apps/alpha",
				"packages/zeta",
			]);
		});
	});

	it("writes a module config that reads back identically", async () => {
		await withTempDir("config-write", async (directory) => {
			const moduleRoot = join(directory, "packages/utils");

			const config: PackageConfig = {
				id: "fghij",
				type: "package",
				packageType: "lib",
				template: { id: "package/base", version: 1 },
				capabilities: ["auth"],
				slots: { index: "src/index.ts" },
			};

			await Effect.runPromise(
				ConfigStore.write(moduleRoot, config).pipe(
					Effect.provide(projectLayer),
				),
			);

			const read = await Effect.runPromise(
				ConfigStore.read(moduleRoot).pipe(Effect.provide(projectLayer)),
			);

			expect(read).toEqual(config);

			const raw = await readFile(join(moduleRoot, "forge.json"), "utf-8");

			expect(raw).toBe(`{
  "id": "fghij",
  "type": "package",
  "packageType": "lib",
  "template": {
    "id": "package/base",
    "version": 1
  },
  "capabilities": [
    "auth"
  ],
  "slots": {
    "index": "src/index.ts"
  }
}
`);
		});
	});

	it("maps config directory failures with the original cause", async () => {
		await withTempDir("config-directory-failure", async (directory) => {
			const moduleRoot = join(directory, "packages/utils");
			const path = join(moduleRoot, "forge.json");
			const cause = new PlatformError.SystemError({
				method: "makeDirectory",
				module: "FileSystem",
				pathOrDescriptor: moduleRoot,
				reason: "PermissionDenied",
			});
			const failingLayer = configLayerWithFileSystem((fileSystem) => ({
				...fileSystem,
				makeDirectory: (target, options) =>
					target === moduleRoot
						? Effect.fail(cause)
						: fileSystem.makeDirectory(target, options),
			}));
			const config: PackageConfig = {
				id: "fghij",
				type: "package",
				packageType: "lib",
				template: { id: "package/base", version: 1 },
				capabilities: [],
				slots: { index: "src/index.ts" },
			};

			const error = await failure(
				ConfigStore.write(moduleRoot, config).pipe(
					Effect.provide(failingLayer),
				),
			);

			expect(error._tag).toBe("ModuleConfigError");
			if (error._tag !== "ModuleConfigError")
				throw new Error("Expected Module Config Error");
			expect(error.filePath).toBe(path);
			expect(error.reason).toBe("directory-failed");
			expect(error.message).toBe("Module Config Directory Failed");
			expect(error.cause).toMatchObject({
				_tag: "SystemError",
				method: "makeDirectory",
				pathOrDescriptor: moduleRoot,
				reason: "PermissionDenied",
			});
		});
	});
});

describe("command probe", () => {
	it("maps a missing command to a typed probe error", async () => {
		const error = await failure(
			CommandProbe.readVersion("forge-test-nonexistent-cmd-xyz").pipe(
				Effect.provide(projectLayer),
			),
		);

		expect(error._tag).toBe("CommandProbeError");
		expect(error.command).toBe("forge-test-nonexistent-cmd-xyz");
		expect(error.message).toBe("Command Probe Failed");
		expect(error.detail.length).toBeGreaterThan(0);
	});
});
