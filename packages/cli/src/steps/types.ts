import type { z } from "zod";

export const SKIP = Symbol.for("forge:skip");
export type Skip = typeof SKIP;

export type PartialConfig = Record<string, unknown>;

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

export interface Step<TOutput = unknown> {
	id: string;
	group: StepGroup;
	schema: z.ZodType<TOutput> | null;
	configKey?: string | null;
	schemaShape?: Record<string, z.ZodType>;
	dependencies?: string[];
	shouldRun: (config: PartialConfig) => boolean;
	execute: (
		config: PartialConfig,
		interactive: boolean,
	) => Promise<TOutput | Skip | undefined>;
}

export function defineStep<TOutput>(step: Step<TOutput>): Step<TOutput> {
	return step;
}
