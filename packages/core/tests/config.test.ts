import { readFile } from "node:fs/promises";
import { join } from "node:path";
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
});

describe("command probe", () => {
	it("maps a missing command to a typed probe error", async () => {
		const error = await failure(
			CommandProbe.readVersion("forge-test-nonexistent-cmd-xyz").pipe(
				Effect.provide(CommandProbe.Default),
			),
		);

		expect(error._tag).toBe("CommandProbeError");
		expect(error.command).toBe("forge-test-nonexistent-cmd-xyz");
		expect(error.message).toBe("Command Probe Failed");
		expect(error.detail.length).toBeGreaterThan(0);
	});
});
