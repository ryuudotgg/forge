import type { Generator } from "./generator";

export function resolve<Config>(
	config: Config,
	generators: ReadonlyArray<Generator<Config>>,
): ReadonlyArray<Generator<Config>> {
	return generators.filter((g) => g.appliesTo(config));
}
