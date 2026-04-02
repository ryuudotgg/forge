import { intro, log, outro, spinner } from "@clack/prompts";
import { NodeContext } from "@effect/platform-node";
import { applyPlan, readManifest, reconcile } from "@ryuujs/core";
import type { ForgeConfig } from "@ryuujs/generators";
import { generators } from "@ryuujs/generators";
import { Effect } from "effect";
import { orchestrate } from "../orchestrator";
import { steps } from "../steps";
import type { PartialConfig, StepGroup } from "../steps/types";
import { resolveConflicts } from "./resolve-conflicts";
import { configSchema, listAnd, listOr, plural, summarizePlan } from "./shared";

const CONFIG_GROUPS: ReadonlySet<StepGroup> = new Set([
	"project",
	"platforms",
	"backend",
	"data",
	"auth",
	"style",
]);

const CATEGORY_CONFIG_KEY: Record<string, string> = {
	linter: "linter",
	web: "web",
	desktop: "desktop",
	mobile: "mobile",
	backend: "backend",
	orm: "orm",
	database: "database",
	auth: "authentication",
	style: "styleFramework",
	runtime: "runtime",
	packageManager: "packageManager",
};

export async function runAdd(
	generatorId: string,
	values: Record<string, string | boolean | undefined>,
) {
	const acceptIncoming = values["accept-incoming"] === true;
	const projectRoot = ".";

	intro(`Adding ${generatorId}...`);

	const manifest = await Effect.runPromise(
		readManifest(projectRoot).pipe(Effect.provide(NodeContext.layer)),
	);

	const generator = generators.find((g) => g.id === generatorId);

	if (!generator) {
		log.error(
			`We couldn't find "${generatorId}". You can use: ${listOr.format(generators.map((g) => g.id))}.`,
		);

		process.exit(1);
	}

	const installedIds = new Set(manifest.generators.map((g) => g.id));

	if (installedIds.has(generatorId)) {
		log.warn(`You've already added "${generatorId}".`);

		process.exit(1);
	}

	const depsToAdd = generator.dependencies.filter(
		(dep) => !installedIds.has(dep),
	);

	for (const dep of depsToAdd) {
		const depGen = generators.find((g) => g.id === dep);

		if (!depGen) {
			log.error(
				`"${generatorId}" requires "${dep}", but it couldn't be found.`,
			);

			process.exit(1);
		}
	}

	if (depsToAdd.length > 0) {
		log.info(
			`Also adding ${listAnd.format(depsToAdd)} as ${plural(depsToAdd.length, "a dependency", "dependencies")}.`,
		);
	}

	let newConfig: ForgeConfig = { ...manifest.config };

	if (!generator.appliesTo(newConfig)) {
		const configKey = CATEGORY_CONFIG_KEY[generator.category];

		if (configKey) {
			log.info("We need some additional information to complete the setup.");

			const initialConfig: PartialConfig = { ...manifest.config };
			delete initialConfig[configKey];

			const configSteps = steps.filter((s) => CONFIG_GROUPS.has(s.group));
			const collected = await orchestrate(configSteps, {
				initialConfig,
				interactive: true,
			});

			newConfig = collected;
		}

		if (!generator.appliesTo(newConfig)) {
			log.error(
				`"${generatorId}" doesn't apply to your current configuration.`,
			);

			process.exit(1);
		}
	}

	const newGeneratorIds = new Set([...installedIds, generatorId, ...depsToAdd]);
	const newGenerators = generators.filter((g) => newGeneratorIds.has(g.id));

	const s = spinner();
	s.start("Analyzing...");

	const plan = await Effect.runPromise(
		reconcile({
			projectRoot,
			newConfig,
			configSchema,
			newGenerators,
			baseGenerators: generators.filter((g) => installedIds.has(g.id)),
		}).pipe(Effect.provide(NodeContext.layer)),
	);

	if (plan.items.length === 0) {
		s.stop("Your project is ready to go!");
		return;
	}

	s.stop(summarizePlan(plan).message);

	const resolutions = await resolveConflicts(plan.items, acceptIncoming);

	s.start("Forging...");

	await Effect.runPromise(
		applyPlan(plan, resolutions, projectRoot).pipe(
			Effect.provide(NodeContext.layer),
		),
	);

	s.stop("Forged!");
	outro(`We added "${generatorId}" to your project.`);
}
