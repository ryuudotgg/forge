import { Either, Schema } from "effect";
import { ArrayFormatter } from "effect/ParseResult";
import {
	applyConfigDefaults,
	assembleSchema,
	type Config,
} from "./config/schema";
import type { PartialConfig, Step } from "./steps/types";
import { SKIP } from "./steps/types";

export interface OrchestratorOptions {
	interactive: boolean;
	initialConfig: PartialConfig;
}

export async function orchestrate(
	steps: Step[],
	options: OrchestratorOptions,
): Promise<Config> {
	const { interactive } = options;
	const config: PartialConfig = { ...options.initialConfig };

	for (const step of steps) {
		if (!step.shouldRun(config)) continue;

		const key = step.configKey === null ? null : (step.configKey ?? step.id);

		if (key !== null && key in config && config[key] !== undefined) continue;

		if (key === null && step.schemaShape) {
			const shapeKeys = Object.keys(step.schemaShape);
			if (shapeKeys.every((k) => k in config && config[k] !== undefined))
				continue;
		}

		const result = await step.execute(config, interactive);
		if (result === SKIP || result === undefined) continue;

		if (key === null) Object.assign(config, result);
		else config[key] = result;
	}

	const schema = assembleSchema(steps);
	const result = Schema.decodeUnknownEither(schema)(config);

	if (Either.isLeft(result)) {
		const issues = ArrayFormatter.formatErrorSync(result.left);
		const message = issues
			.map((i) =>
				i.path.length > 0
					? `  ${i.path.join(".")}: ${i.message}`
					: `  ${i.message}`,
			)
			.join("\n");

		throw new Error(`Invalid Configuration:\n${message}`);
	}

	return applyConfigDefaults(result.right);
}
