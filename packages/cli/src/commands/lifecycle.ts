import { log } from "@clack/prompts";
import { NodeContext } from "@effect/platform-node";
import {
	Apply,
	ConfigStore,
	CoreLive,
	type DiscoveredModule,
	type InstallRecord,
	type Manifest,
	Planner,
	State,
} from "@ryuujs/core";
import { type ForgeConfig, loadDefinitionRegistry } from "@ryuujs/generators";
import { Cause, Effect, Exit, Layer, Option } from "effect";
import { inferConfigSnapshot } from "./infer-config";

const coreLayer = CoreLive.pipe(Layer.provideMerge(NodeContext.layer));

function lifecycleUnavailableMessage(command: string) {
	return `We couldn't run "${command}" here because this project hasn't been bootstrapped with the current Forge metadata yet.`;
}

async function runLifecycleEffect<A, E extends { readonly message: string }>(
	effect: Effect.Effect<A, E>,
	failureMessage: string,
): Promise<A> {
	const exit = await Effect.runPromiseExit(effect);
	if (Exit.isSuccess(exit)) return exit.value;

	const failure = Cause.failureOption(exit.cause);
	if (Option.isSome(failure)) {
		const detail = failure.value.message;
		log.error(
			`${failureMessage} ${detail.endsWith(".") ? detail.slice(0, -1) : detail}.`,
		);

		process.exit(1);
	}

	throw Cause.squash(exit.cause);
}

export interface ManagedProject {
	readonly config: ForgeConfig;
	readonly manifest: Manifest;
	readonly modules: ReadonlyArray<DiscoveredModule>;
	readonly projectRoot: string;
}

export async function loadManagedProject(
	projectRoot: string,
	command: string,
): Promise<ManagedProject> {
	const isManagedProject = await runLifecycleEffect(
		State.isManagedProject(projectRoot).pipe(Effect.provide(coreLayer)),
		"We couldn't read this project's Forge metadata.",
	);

	if (!isManagedProject) {
		log.error(lifecycleUnavailableMessage(command));
		process.exit(1);
	}

	const [manifest, modules] = await Promise.all([
		runLifecycleEffect(
			State.readManifest(projectRoot).pipe(Effect.provide(coreLayer)),
			"We couldn't read this project's Forge metadata.",
		),
		runLifecycleEffect(
			ConfigStore.discover(projectRoot).pipe(Effect.provide(coreLayer)),
			"We couldn't read this project's modules.",
		),
	]);

	const config =
		Object.keys(manifest.config).length > 0
			? (manifest.config as ForgeConfig)
			: await inferConfigSnapshot(projectRoot, modules);

	const needsNormalization =
		manifest.installs.length === 0 ||
		Object.values(manifest.modules).some(
			(record) =>
				record.definitionIds.length === 0 || record.root === undefined,
		);

	const normalizedManifest = needsNormalization
		? (
				await runLifecycleEffect(
					Effect.flatMap(Planner, (planner) =>
						Effect.sync(() => loadDefinitionRegistry()).pipe(
							Effect.flatMap((loadedRegistry) =>
								planner.planInstalled(
									projectRoot,
									config,
									manifest.installs,
									loadedRegistry.registry,
								),
							),
						),
					).pipe(Effect.provide(coreLayer)),
					"We couldn't plan this change.",
				)
			).manifest
		: manifest;

	return {
		config,
		manifest: normalizedManifest,
		modules,
		projectRoot,
	};
}

export async function applyInstalledPlan(
	projectRoot: string,
	config: ForgeConfig,
	installs: ReadonlyArray<InstallRecord>,
) {
	const loadedRegistry = await loadDefinitionRegistry();
	const plan = await runLifecycleEffect(
		Effect.flatMap(Planner, (planner) =>
			planner.planInstalled(
				projectRoot,
				config,
				installs,
				loadedRegistry.registry,
			),
		).pipe(Effect.provide(coreLayer)),
		"We couldn't plan this change.",
	);

	await runLifecycleEffect(
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
		"We couldn't apply this change.",
	);
}
