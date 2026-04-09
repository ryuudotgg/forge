import { NodeContext } from "@effect/platform-node";
import { Apply, CoreLive, Planner } from "@ryuujs/core";
import { builtins, type ForgeConfig } from "@ryuujs/generators";
import { Effect, Layer } from "effect";
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
			const plan = await Effect.runPromise(
				Effect.flatMap(Planner, (planner) =>
					planner.planCreate(projectRoot, forgeConfig, builtins),
				).pipe(Effect.provide(coreLayer)),
			);
			await Effect.runPromise(
				Apply.applyPlan(projectRoot, {
					lockfile: plan.lockfile,
					manifest: plan.manifest,
					removals: plan.removals,
					writes: plan.writes.map((write) => ({
						content: write.content,
						path: write.path,
					})),
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
