import type { Schema } from "effect";
import type * as ConfigSchemas from "./schemas";

export const SKIP = Symbol.for("forge:skip");
export type Skip = typeof SKIP;

export type PartialConfig = {
	[K in keyof typeof ConfigSchemas]?: Schema.Schema.Type<
		(typeof ConfigSchemas)[K]
	>;
} & { [key: string]: unknown };

export type StepGroup =
	| "intro"
	| "project"
	| "platforms"
	| "backend"
	| "data"
	| "auth"
	| "style"
	| "addons"
	| "generate"
	| "outro";

export interface Step {
	id: string;
	group: StepGroup;
	schema: Schema.Codec<unknown, unknown, never, never> | null;
	configKey?: string | null;
	schemaShape?: Record<string, Schema.Codec<unknown, unknown, never, never>>;
	schemaDefault?: () => unknown;
	dependencies?: string[];
	shouldRun: (config: PartialConfig) => boolean;
	validate?: (value: unknown, config: PartialConfig) => void | Promise<void>;
	execute: (config: PartialConfig, interactive: boolean) => Promise<unknown>;
}

export function defineStep<TOutput>(step: {
	id: string;
	group: StepGroup;
	schema: Schema.Codec<TOutput, TOutput, never, never> | null;
	configKey?: string | null;
	schemaShape?: Record<string, Schema.Codec<unknown, unknown, never, never>>;
	schemaDefault?: () => TOutput;
	dependencies?: string[];
	shouldRun: (config: PartialConfig) => boolean;
	validate?: (value: unknown, config: PartialConfig) => void | Promise<void>;
	execute: (
		config: PartialConfig,
		interactive: boolean,
	) => Promise<TOutput | Skip | undefined>;
}): Step {
	return step;
}
