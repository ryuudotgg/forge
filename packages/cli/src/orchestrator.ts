import { Result, Schema } from "effect";
import {
	assembleSchema,
	type Config,
	invalidConfigMessage,
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

	const runSteps = async (stepsToRun: Step[]) => {
		for (const step of stepsToRun) {
			if (!step.shouldRun(config)) continue;

			const key = step.configKey === null ? null : (step.configKey ?? step.id);
			if (key !== null && key in config && config[key] !== undefined) {
				await step.validate?.(config[key], config);
				continue;
			}

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
	};

	const decodeConfig = () => {
		const schema = assembleSchema(steps);
		const result = Schema.decodeResult(schema)(config);
		if (Result.isFailure(result))
			throw new Error(invalidConfigMessage(result.failure, config));

		return result.success;
	};

	const sideEffectingStepIds = new Set([
		"generate",
		"installDeps",
		"gitInit",
		"outro",
	]);

	const preSideEffectSteps = steps.filter(
		(step) => !sideEffectingStepIds.has(step.id),
	);

	const sideEffectingSteps = steps.filter((step) =>
		sideEffectingStepIds.has(step.id),
	);

	await runSteps(preSideEffectSteps);

	const decodedConfig = decodeConfig();
	Object.assign(config, decodedConfig);

	await runSteps(sideEffectingSteps);

	return decodedConfig;
}
