import { log } from "@clack/prompts";
import { Apply, ApplyError, formatApplyError, Planner } from "@ryuugg/core";
import {
	loadDefinitionRegistry,
	probeWorkspaceCommandVersions,
	withWebAppPorts,
} from "@ryuugg/generators";
import { Effect } from "effect";
import { ormIssue } from "../config/schema";
import { runCliEffectValue } from "../runtime";
import { refusalMessage } from "../utils/refusal";
import type { PartialConfig } from "./types";
import { defineStep, SKIP } from "./types";

const generateStep = defineStep({
	id: "generate",
	group: "generate",
	schema: null,
	configKey: null,

	shouldRun: () => true,

	async execute(config: PartialConfig) {
		const issue = ormIssue(config);
		if (issue !== undefined) {
			log.error(issue);
			process.exit(1);
		}

		const projectRoot = String(config.path ?? ".");
		const { webApps, ...withoutWebApps } = config;
		const forgeConfig = withWebAppPorts(
			Array.isArray(webApps) && webApps.length === 0 ? withoutWebApps : config,
		);

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
			const refusal = refusalMessage(error);
			if (refusal !== undefined) throw new Error(refusal);

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
