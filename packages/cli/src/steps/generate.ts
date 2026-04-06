import { NodeContext } from "@effect/platform-node";
import { CoreLive, run } from "@ryuujs/core";
import { type ForgeConfig, generators } from "@ryuujs/generators";
import { Effect, Layer } from "effect";
import { bootstrapProject } from "../bootstrap/project";
import type { PartialConfig } from "./types";
import { defineStep, SKIP } from "./types";

const generateStep = defineStep({
	id: "generate",
	group: "generate",
	schema: null,
	configKey: null,

	shouldRun: () => true,

	async execute(config: PartialConfig) {
		const projectRoot = String(config.path ?? ".");
		const forgeConfig: ForgeConfig = config;

		const coreLayer = CoreLive.pipe(Layer.provideMerge(NodeContext.layer));

		try {
			const result = await Effect.runPromise(
				run(forgeConfig, generators, projectRoot).pipe(
					Effect.provide(coreLayer),
				),
			);
			await Effect.runPromise(
				bootstrapProject({
					config: forgeConfig,
					ordered: result.ordered,
					projectRoot,
					resolved: result.resolved,
				}).pipe(Effect.provide(coreLayer)),
			);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			throw new Error(`Generation Failed: ${message}`);
		}

		return SKIP;
	},
});

export default generateStep;
