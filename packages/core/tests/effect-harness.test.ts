import { expect, layer } from "@effect/vitest";
import { Effect, FileSystem } from "effect";
import {
	ConfigStore,
	Environment,
	PROBE_TIMEOUT_MS,
	State,
	Subprocess,
} from "../src/index";
import {
	configStoreLayerTest,
	environmentLayerTest,
	stateLayerTest,
	subprocessLayerTest,
	TestDirectory,
} from "./layers";

layer(stateLayerTest())("State layerTest", (it) => {
	it.effect("uses a scoped directory with the real State service", () =>
		Effect.gen(function* () {
			const directory = yield* TestDirectory;
			const fileSystem = yield* FileSystem.FileSystem;

			expect(yield* fileSystem.exists(directory.path)).toBe(true);
			expect(yield* State.isManagedProject(directory.path)).toBe(false);
		}),
	);
});

layer(configStoreLayerTest())("ConfigStore layerTest", (it) => {
	it.effect("discovers no modules in a scoped empty directory", () =>
		Effect.gen(function* () {
			const directory = yield* TestDirectory;

			expect(yield* ConfigStore.discover(directory.path)).toEqual([]);
		}),
	);
});

layer(environmentLayerTest())("Environment layerTest", (it) => {
	it.effect("checks the current runtime through the real service", () =>
		Effect.gen(function* () {
			expect(yield* Environment.checkRuntime).toEqual({
				ok: true,
				message: `Node.js v${process.versions.node}`,
			});
		}),
	);
});

layer(subprocessLayerTest())("Subprocess layerTest", (it) => {
	it.effect("runs a real command from the scoped directory", () =>
		Effect.gen(function* () {
			const directory = yield* TestDirectory;
			const result = yield* Subprocess.run({
				command: process.execPath,
				args: ["-e", 'process.stdout.write("effect-vitest")'],
				cwd: directory.path,
				timeoutMs: PROBE_TIMEOUT_MS,
				outputMode: "capture",
			});

			expect(result).toEqual({ exitCode: 0, output: "effect-vitest" });
		}),
	);
});
