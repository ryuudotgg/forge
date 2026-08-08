import { NodeServices } from "@effect/platform-node";
import { Context, Effect, FileSystem, Layer } from "effect";
import {
	CommandProbe,
	ConfigStore,
	Environment,
	State,
	Subprocess,
} from "../src/index";

interface TestDirectoryService {
	readonly path: string;
}

export class TestDirectory extends Context.Service<
	TestDirectory,
	TestDirectoryService
>()("@ryuujs/core/tests/TestDirectory") {}

function testDirectoryLayer(prefix: string) {
	return Layer.effect(
		TestDirectory,
		Effect.gen(function* () {
			const fileSystem = yield* FileSystem.FileSystem;
			const path = yield* fileSystem.makeTempDirectoryScoped({ prefix });

			return { path };
		}),
	).pipe(Layer.provideMerge(NodeServices.layer));
}

function withTestDirectory<Service, Error>(
	prefix: string,
	serviceLayer: Layer.Layer<Service, Error>,
) {
	return Layer.merge(serviceLayer, testDirectoryLayer(prefix));
}

export function stateLayerTest(prefix = "forge-state-test-") {
	return withTestDirectory(
		prefix,
		State.Default.pipe(Layer.provide(NodeServices.layer)),
	);
}

export function configStoreLayerTest(prefix = "forge-config-test-") {
	return withTestDirectory(
		prefix,
		ConfigStore.Default.pipe(Layer.provide(NodeServices.layer)),
	);
}

export function environmentLayerTest(prefix = "forge-environment-test-") {
	const subprocess = Subprocess.Default.pipe(Layer.provide(NodeServices.layer));
	const commandProbe = CommandProbe.Default.pipe(Layer.provide(subprocess));
	const environment = Environment.Default.pipe(Layer.provide(commandProbe));

	return withTestDirectory(prefix, environment);
}

export function subprocessLayerTest(prefix = "forge-subprocess-test-") {
	return withTestDirectory(
		prefix,
		Subprocess.Default.pipe(Layer.provide(NodeServices.layer)),
	);
}
