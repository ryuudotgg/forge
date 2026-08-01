import { resolve } from "node:path";
import { log } from "@clack/prompts";
import { Command, FileSystem } from "@effect/platform";
import { NodeContext, NodeFileSystem } from "@effect/platform-node";
import {
	Apply,
	ApplyError,
	ConfigStore,
	CoreLive,
	type DiscoveredModule,
	formatApplyError,
	type InstallRecord,
	isPackageManager,
	type Manifest,
	type PackageManager,
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
import { Cause, Effect, Either, Exit, Layer, Option, Schema } from "effect";

const coreLayer = CoreLive.pipe(Layer.provideMerge(NodeContext.layer));

const ProjectPackageJsonSchema = Schema.parseJson(
	Schema.Struct({
		devDependencies: Schema.optional(
			Schema.Record({ key: Schema.String, value: Schema.Unknown }),
		),
	}),
);

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

export function configuredPackageManager(
	config: Manifest["config"],
): PackageManager {
	return isPackageManager(config.packageManager)
		? config.packageManager
		: "pnpm";
}

export async function loadManagedProject(
	projectRoot: string,
	_command: string,
): Promise<ManagedProject> {
	const absoluteProjectRoot = resolve(projectRoot);
	const manifest = await runLifecycleEffect(
		State.readManifest(absoluteProjectRoot).pipe(
			Effect.catchTag("StateError", (error) =>
				error.message === "Manifest Not Found"
					? Effect.void
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
		ConfigStore.discover(absoluteProjectRoot).pipe(Effect.provide(coreLayer)),
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
		projectRoot: absoluteProjectRoot,
	};
}

export async function hasProjectDevDependency(
	projectRoot: string,
	packageId: string,
) {
	return runLifecycleEffect(
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			const raw = yield* fs.readFileString(`${projectRoot}/package.json`);
			const packageJson = yield* Schema.decodeUnknown(ProjectPackageJsonSchema)(
				raw,
			);

			return (
				packageJson.devDependencies !== undefined &&
				Object.hasOwn(packageJson.devDependencies, packageId)
			);
		}).pipe(Effect.provide(NodeContext.layer)),
		"We couldn't read this project's package.json.",
	);
}

export async function runPackageManagerOperation(
	projectRoot: string,
	operation: {
		readonly args: ReadonlyArray<string>;
		readonly command: string;
	},
) {
	const exit = await Effect.runPromiseExit(
		Command.exitCode(
			Command.make(operation.command, ...operation.args).pipe(
				Command.workingDirectory(projectRoot),
				Command.stdout("pipe"),
				Command.stderr("pipe"),
			),
		).pipe(Effect.provide(NodeContext.layer)),
	);

	return Exit.isSuccess(exit) && exit.value === 0;
}

async function loadProjectRegistryData(
	projectRoot: string,
	registryIds: ReadonlyArray<string>,
) {
	return registryIds.length === 0
		? loadDefinitionRegistry()
		: await loadDefinitionRegistry({
				importRegistry: importRegistryPackage,
				projectRoot,
				registries: registryIds,
			});
}

export async function loadProjectRegistry(
	projectRoot: string,
	registryIds: ReadonlyArray<string>,
) {
	try {
		return await loadProjectRegistryData(projectRoot, registryIds);
	} catch (error) {
		if (error instanceof RegistryLoadError) {
			log.error(error.message);
			process.exit(1);
		}
		throw error;
	}
}

function discoveryWarning(action: string, error: unknown) {
	const detail = error instanceof Error ? error.message : String(error);
	return `We couldn't ${action} (${detail}), so we're showing the first-party catalog.`;
}

export async function loadDiscoveryRegistry(projectRoot: string) {
	const absoluteProjectRoot = resolve(projectRoot);
	const manifestResult = await Effect.runPromise(
		State.readManifest(absoluteProjectRoot).pipe(
			Effect.catchTag("StateError", (error) =>
				error.message === "Manifest Not Found"
					? Effect.void
					: Effect.fail(error),
			),
			Effect.either,
			Effect.provide(coreLayer),
		),
	);

	if (Either.isLeft(manifestResult)) {
		log.warn(
			discoveryWarning(
				"read this project's Forge metadata",
				manifestResult.left,
			),
			{ output: process.stderr },
		);

		return loadDefinitionRegistry();
	}

	const registryIds = manifestResult.right?.registries ?? [];
	if (registryIds.length === 0) return loadDefinitionRegistry();

	try {
		return await loadProjectRegistryData(absoluteProjectRoot, registryIds);
	} catch (error) {
		log.warn(discoveryWarning("load this project's registries", error), {
			output: process.stderr,
		});

		return loadDefinitionRegistry();
	}
}

export async function applyInstalledPlan(
	projectRoot: string,
	config: Manifest["config"],
	installs: ReadonlyArray<InstallRecord>,
	providedCommandVersions?: Readonly<Record<string, string>>,
	registryIds?: ReadonlyArray<string>,
) {
	const loadedRegistry = await loadProjectRegistry(
		projectRoot,
		registryIds ?? [],
	);

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
				registryIds,
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
