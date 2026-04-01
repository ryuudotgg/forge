import type { Generator } from "./Generator";

export function resolve<Config>(
	config: Config,
	generators: ReadonlyArray<Generator<Config>>,
): ReadonlyArray<Generator<Config>> {
	return generators.filter((g) => g.appliesTo(config));
}
