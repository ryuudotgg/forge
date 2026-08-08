import { log } from "@clack/prompts";
import { Apply, ApplyError, formatApplyError, Planner } from "@ryuujs/core";
import {
	authenticationProviders,
	type ForgeConfig,
	loadDefinitionRegistry,
	orms,
	probeWorkspaceCommandVersions,
} from "@ryuujs/generators";
import { Effect } from "effect";
import { runCliEffectValue } from "../runtime";
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

		try {
			const loadedRegistry = await loadDefinitionRegistry();
			const plan = await runCliEffectValue(
				Effect.gen(function* () {
					const commandVersions =
						yield* probeWorkspaceCommandVersions(forgeConfig);

					const planner = yield* Planner;
					return yield* planner.planCreate(
						projectRoot,
						forgeConfig,
						loadedRegistry.registry,
						commandVersions,
					);
				}),
			);

			await runCliEffectValue(
				Apply.applyPlan(projectRoot, {
					lockfile: plan.lockfile,
					manifest: plan.manifest,
					removals: plan.removals,
					writes: plan.writes.map((write) => ({
						artifactId: write.artifactId,
						content: write.content,
						path: write.path,
					})),
				}),
			);
		} catch (error) {
			const message =
				error instanceof ApplyError
					? formatApplyError(error)
					: error instanceof Error
						? error.message
						: String(error);
			throw new Error(`Generation Failed: ${message}`);
		}

		return SKIP;
	},
});

export default generateStep;
