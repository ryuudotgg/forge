import { log } from "@clack/prompts";
import { NodeContext, NodeFileSystem } from "@effect/platform-node";
import {
	Apply,
	ApplyError,
	ConfigStore,
	CoreLive,
	type DiscoveredModule,
	formatApplyError,
	type InstallRecord,
	type Manifest,
	Planner,
	packageManagerCommand,
	readPersistedCommandVersions,
	runtimeCommand,
	State,
} from "@ryuujs/core";
import {
	type ForgeConfig,
	importRegistryPackage,
	loadDefinitionRegistry,
	probeWorkspaceCommandVersions,
	RegistryLoadError,
} from "@ryuujs/generators";
import { Cause, Effect, Exit, Layer, Option } from "effect";

const coreLayer = CoreLive.pipe(Layer.provideMerge(NodeContext.layer));

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

function lifecycleUnavailableMessage() {
	return "We couldn't find a Forge project here. The .forge directory is missing or incomplete.";
}

async function runLifecycleEffect<A, E extends { readonly message: string }>(
	effect: Effect.Effect<A, E>,
	failureMessage: string,
): Promise<A> {
	const exit = await Effect.runPromiseExit(effect);
	if (Exit.isSuccess(exit)) return exit.value;

	const failure = Cause.failureOption(exit.cause);
	if (Option.isSome(failure)) {
		const detail =
			failure.value instanceof ApplyError
				? formatApplyError(failure.value)
				: failure.value.message;
		log.error(
			`${failureMessage} ${detail.endsWith(".") ? detail.slice(0, -1) : detail}.`,
		);

		process.exit(1);
	}

	throw Cause.squash(exit.cause);
}

export interface ManagedProject {
	readonly config: Manifest["config"];
	readonly manifest: Manifest;
	readonly modules: ReadonlyArray<DiscoveredModule>;
	readonly projectRoot: string;
}

export async function loadManagedProject(
	projectRoot: string,
	_command: string,
): Promise<ManagedProject> {
	const manifest = await runLifecycleEffect(
		State.readManifest(projectRoot).pipe(
			Effect.catchTag("StateError", (error) =>
				error.message === "Manifest Not Found"
					? Effect.succeed(undefined)
					: Effect.fail(error),
			),
			Effect.provide(coreLayer),
		),
		"We couldn't read this project's Forge metadata.",
	);

	if (manifest === undefined) {
		log.error(lifecycleUnavailableMessage());
		process.exit(1);
	}

	const modules = await runLifecycleEffect(
		ConfigStore.discover(projectRoot).pipe(Effect.provide(coreLayer)),
		"We couldn't read this project's modules.",
	);

	if (Object.keys(manifest.config).length === 0) {
		log.error(lifecycleUnavailableMessage());
		process.exit(1);
	}

	return {
		config: manifest.config,
		manifest,
		modules,
		projectRoot,
	};
}

export async function applyInstalledPlan(
	projectRoot: string,
	config: Manifest["config"],
	installs: ReadonlyArray<InstallRecord>,
	providedCommandVersions?: Readonly<Record<string, string>>,
	registryIds: ReadonlyArray<string> = [],
) {
	let loadedRegistry: ReturnType<typeof loadDefinitionRegistry>;
	try {
		loadedRegistry =
			registryIds.length === 0
				? loadDefinitionRegistry()
				: await loadDefinitionRegistry({
						importRegistry: importRegistryPackage,
						projectRoot,
						registries: registryIds,
					});
	} catch (error) {
		if (error instanceof RegistryLoadError) {
			log.error(error.message);
			process.exit(1);
		}
		throw error;
	}

	const plan = await runLifecycleEffect(
		Effect.gen(function* () {
			const commandVersions =
				providedCommandVersions ??
				(yield* readWorkspaceCommandVersions(
					projectRoot,
					config satisfies ForgeConfig,
				));

			const planner = yield* Planner;
			return yield* planner.planInstalled(
				projectRoot,
				config,
				installs,
				loadedRegistry.registry,
				commandVersions,
				loadedRegistry.descriptors,
			);
		}).pipe(Effect.provide(Layer.mergeAll(coreLayer, NodeFileSystem.layer))),
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
