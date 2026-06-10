import { log } from "@clack/prompts";
import { NodeContext } from "@effect/platform-node";
import { Apply, CoreLive, Planner } from "@ryuujs/core";
import {
	authenticationProviders,
	type ForgeConfig,
	loadDefinitionRegistry,
	orms,
} from "@ryuujs/generators";
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
		if (
			authenticationProviders.normalize(config.authentication) ===
				"better-auth" &&
			!orms.normalize(config.orm)
		) {
			log.error("You need to add an ORM before you can use Better Auth.");
			process.exit(1);
		}

		const projectRoot = String(config.path ?? ".");
		const forgeConfig: ForgeConfig = config;

		const coreLayer = CoreLive.pipe(Layer.provideMerge(NodeContext.layer));

		try {
			const loadedRegistry = await loadDefinitionRegistry();
			const plan = await Effect.runPromise(
				Effect.flatMap(Planner, (planner) =>
					planner.planCreate(projectRoot, forgeConfig, loadedRegistry.registry),
				).pipe(Effect.provide(coreLayer)),
			);

			await Effect.runPromise(
				Apply.applyPlan(projectRoot, {
					lockfile: plan.lockfile,
					manifest: plan.manifest,
					removals: plan.removals,
					writes: plan.writes.map((write) => ({
						artifactId: write.artifactId,
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
