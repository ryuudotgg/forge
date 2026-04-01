import { intro, outro, spinner } from "@clack/prompts";
import { NodeContext } from "@effect/platform-node";
import {
	applyPlan,
	type Generator,
	readManifest,
	reconcile,
} from "@ryuujs/core";
import type { ForgeConfig } from "@ryuujs/generators";
import { generators } from "@ryuujs/generators";
import { Effect } from "effect";
import { buildFlagOverrides } from "../cli";
import { fetchBaseGenerators } from "./fetch-generators";
import { resolveConflicts } from "./resolve-conflicts";
import { configSchema, summarizePlan } from "./shared";

export async function runUpdate(
	values: Record<string, string | boolean | undefined>,
) {
	const acceptIncoming = values["accept-incoming"] === true;
	const projectRoot = ".";

	intro("We're updating your project...");

	const manifest = await Effect.runPromise(
		readManifest(projectRoot).pipe(Effect.provide(NodeContext.layer)),
	);

	const overrides = buildFlagOverrides(values);
	const newConfig: ForgeConfig = { ...manifest.config, ...overrides };

	const s = spinner();
	s.start("We're fetching the previous generator version...");

	const manifestVersion = manifest.generators[0]?.version;
	let baseGenerators: ReadonlyArray<Generator<ForgeConfig>> | null = null;

	if (manifestVersion) {
		const currentVersion = generators[0]?.version;

		if (manifestVersion === currentVersion) baseGenerators = generators;
		else baseGenerators = await fetchBaseGenerators(manifestVersion);
	}

	s.message("Analyzing...");

	const plan = await Effect.runPromise(
		reconcile({
			projectRoot,
			newConfig,
			configSchema,
			newGenerators: generators,
			baseGenerators,
		}).pipe(Effect.provide(NodeContext.layer)),
	);

	if (plan.items.length === 0) {
		s.stop("Your project is already up to date.");
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
	outro("We've updated your project.");
}
