import type { Effect } from "effect";
import type { CommandProbe } from "./command";
import type { GeneratorError } from "./errors";
import type { FileOperation } from "./operations";

export type GeneratorCategory =
	| "workspace"
	| "tooling"
	| "linter"
	| "web"
	| "backend"
	| "orm"
	| "database"
	| "auth"
	| "style"
	| "ui"
	| "runtime"
	| "packageManager"
	| "addon";

export interface Generator<Config> {
	readonly id: string;
	readonly name: string;
	readonly version: string;
	readonly category: GeneratorCategory;
	readonly exclusive: boolean;
	readonly dependencies: ReadonlyArray<string>;
	readonly appliesTo: (config: Config) => boolean;
	readonly generate: (
		config: Config,
	) => Effect.Effect<
		ReadonlyArray<FileOperation>,
		GeneratorError,
		CommandProbe
	>;
}

export function defineGenerator<Config>(
	generator: Generator<Config>,
): Generator<Config> {
	return generator;
}
