import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeServices } from "@effect/platform-node";
import {
	Apply,
	CommandProbe,
	ConfigStore,
	type DefinitionRegistry,
	Planner,
	packageManagerCommand,
	Renderer,
	readPersistedCommandVersions,
	runtimeCommand,
	State,
} from "@ryuujs/core";
import { Effect, Layer } from "effect";
import {
	builtins,
	type ForgeConfig,
	probeWorkspaceCommandVersions,
} from "../src";

function readWorkspaceCommandVersions(
	projectRoot: string,
	config: ForgeConfig,
) {
	return Effect.gen(function* () {
		const runtimeCommandName = runtimeCommand(config.runtime ?? "Node.js");
		const packageManagerCommandName = packageManagerCommand(
			config.packageManager ?? "pnpm",
		);

		const persisted = yield* readPersistedCommandVersions(
			projectRoot,
			runtimeCommandName,
			packageManagerCommandName,
		);

		return yield* probeWorkspaceCommandVersions(config, persisted);
	});
}

function makeCommandProbeLayer(versions: Readonly<Record<string, string>>) {
	return Layer.succeed(CommandProbe, {
		readVersion: (command: string) =>
			Effect.succeed(versions[command] ?? "1.0.0"),
	});
}

function makePlannerLayer(versions: Readonly<Record<string, string>>) {
	const plannerBaseLayer = Layer.mergeAll(
		makeCommandProbeLayer(versions),
		ConfigStore.Default,
		Renderer.Default,
		State.Default,
	);

	return Planner.Default.pipe(
		Layer.provideMerge(plannerBaseLayer),
		Layer.provideMerge(NodeServices.layer),
	);
}

export async function plannedDefinitionIds(config: ForgeConfig) {
	const plan = await plannedProject(config);

	return [
		...new Set([
			...plan.manifest.installs.map((install) => install.definitionId),
			...Object.values(plan.manifest.modules).flatMap(
				(module) => module.definitionIds,
			),
		]),
	];
}

export async function plannedProject(
	config: ForgeConfig,
	versions: Readonly<Record<string, string>> = {},
	registry: DefinitionRegistry<ForgeConfig> = builtins,
) {
	const directory = await mkdtemp(join(tmpdir(), "forge-generators-"));
	const plannerLayer = makePlannerLayer(versions);

	try {
		return await Effect.runPromise(
			Effect.gen(function* () {
				const commandVersions = yield* probeWorkspaceCommandVersions(config);

				const planner = yield* Planner;
				return yield* planner.planCreate(
					directory,
					config,
					registry,
					commandVersions,
				);
			}).pipe(Effect.provide(plannerLayer)),
		);
	} finally {
		await rm(directory, { force: true, recursive: true });
	}
}

export async function replannedProject(
	config: ForgeConfig,
	createVersions: Readonly<Record<string, string>>,
	replanVersions: Readonly<Record<string, string>>,
) {
	const directory = await mkdtemp(join(tmpdir(), "forge-generators-"));

	const createLayer = makePlannerLayer(createVersions);
	const replanLayer = makePlannerLayer(replanVersions);

	try {
		const createPlan = await Effect.runPromise(
			Effect.gen(function* () {
				const commandVersions = yield* probeWorkspaceCommandVersions(config);

				const planner = yield* Planner;
				return yield* planner.planCreate(
					directory,
					config,
					builtins,
					commandVersions,
				);
			}).pipe(Effect.provide(createLayer)),
		);

		await Effect.runPromise(
			Apply.applyPlan(directory, {
				lockfile: createPlan.lockfile,
				manifest: createPlan.manifest,
				removals: createPlan.removals,
				writes: createPlan.writes.map((write) => ({
					artifactId: write.artifactId,
					content: write.content,
					path: write.path,
				})),
			}).pipe(
				Effect.provide(
					Layer.mergeAll(Apply.Default, State.Default).pipe(
						Layer.provide(NodeServices.layer),
					),
				),
			),
		);

		const installedPlan = await Effect.runPromise(
			Effect.gen(function* () {
				const commandVersions = yield* readWorkspaceCommandVersions(
					directory,
					config,
				);

				const planner = yield* Planner;
				return yield* planner.planInstalled(
					directory,
					config,
					createPlan.manifest.installs,
					builtins,
					commandVersions,
				);
			}).pipe(Effect.provide(replanLayer)),
		);

		return { createPlan, installedPlan };
	} finally {
		await rm(directory, { force: true, recursive: true });
	}
}
