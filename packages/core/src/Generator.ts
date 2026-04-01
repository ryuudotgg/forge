import type { Effect } from "effect";
import type { GeneratorError } from "./Errors";
import type { FileOperation } from "./Operations";

export interface Generator<Config> {
	readonly id: string;
	readonly name: string;
	readonly version: string;
	readonly dependencies: ReadonlyArray<string>;
	readonly appliesTo: (config: Config) => boolean;
	readonly generate: (
		config: Config,
	) => Effect.Effect<ReadonlyArray<FileOperation>, GeneratorError>;
}

export function defineGenerator<Config>(
	generator: Generator<Config>,
): Generator<Config> {
	return generator;
}
