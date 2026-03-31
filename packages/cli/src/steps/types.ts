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
	schema: Schema.Schema.AnyNoContext | null;
	configKey?: string | null;
	schemaShape?: Record<string, Schema.Schema.AnyNoContext>;
	schemaDefault?: () => unknown;
	dependencies?: string[];
	shouldRun: (config: PartialConfig) => boolean;
	execute: (config: PartialConfig, interactive: boolean) => Promise<unknown>;
}

export function defineStep<TOutput>(step: {
	id: string;
	group: StepGroup;
	schema: Schema.Schema<TOutput, TOutput> | null;
	configKey?: string | null;
	schemaShape?: Record<string, Schema.Schema.AnyNoContext>;
	schemaDefault?: () => TOutput;
	dependencies?: string[];
	shouldRun: (config: PartialConfig) => boolean;
	execute: (
		config: PartialConfig,
		interactive: boolean,
	) => Promise<TOutput | Skip | undefined>;
}): Step {
	return step;
}
