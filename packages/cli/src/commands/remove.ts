import { intro, log, outro, spinner } from "@clack/prompts";
import { NodeContext } from "@effect/platform-node";
import { applyPlan, readManifest, reconcile } from "@ryuujs/core";
import type { ForgeConfig } from "@ryuujs/generators";
import { generators } from "@ryuujs/generators";
import { Effect } from "effect";
import { resolveConflicts } from "./resolve-conflicts";
import { configSchema, listAnd, listOr, plural, summarizePlan } from "./shared";

export async function runRemove(
	generatorId: string,
	values: Record<string, string | boolean | undefined>,
) {
	const acceptIncoming = values["accept-incoming"] === true;
	const projectRoot = ".";

	intro(`We're removing "${generatorId}"...`);

	const manifest = await Effect.runPromise(
		readManifest(projectRoot).pipe(Effect.provide(NodeContext.layer)),
	);

	const installedIds = new Set(manifest.generators.map((g) => g.id));

	if (!installedIds.has(generatorId)) {
		log.error(
			`"${generatorId}" is not installed. You can remove: ${listOr.format([...installedIds])}.`,
		);

		process.exit(1);
	}

	const dependents = generators.filter(
		(g) => installedIds.has(g.id) && g.dependencies.includes(generatorId),
	);

	if (dependents.length > 0) {
		log.error(
			`We can't remove "${generatorId}" because ${listAnd.format(dependents.map((g) => g.id))} ${plural(dependents.length, "depends", "depend")} on it.`,
		);

		process.exit(1);
	}

	installedIds.delete(generatorId);

	const newGenerators = generators.filter((g) => installedIds.has(g.id));
	const newConfig: ForgeConfig = { ...manifest.config };

	const s = spinner();
	s.start("Analyzing...");

	const plan = await Effect.runPromise(
		reconcile({
			projectRoot,
			newConfig,
			configSchema,
			newGenerators,
			baseGenerators: generators.filter((g) =>
				manifest.generators.some((m) => m.id === g.id),
			),
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
	outro(`We removed "${generatorId}" from your project.`);
}
