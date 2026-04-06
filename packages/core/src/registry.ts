import { Effect } from "effect";
import type { Generator } from "./generator";

function resolveGenerators<Config>(
	config: Config,
	generators: ReadonlyArray<Generator<Config>>,
): ReadonlyArray<Generator<Config>> {
	return generators.filter((g) => g.appliesTo(config));
}

export class Registry extends Effect.Service<Registry>()("Registry", {
	effect: Effect.succeed({
		resolve: <Config>(
			config: Config,
			generators: ReadonlyArray<Generator<Config>>,
		) => Effect.sync(() => resolveGenerators(config, generators)),
	}),
}) {}

export function resolve<Config>(
	config: Config,
	generators: ReadonlyArray<Generator<Config>>,
): ReadonlyArray<Generator<Config>> {
	return resolveGenerators(config, generators);
}
