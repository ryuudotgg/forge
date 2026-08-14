import { resolve } from "node:path";
import { log } from "@clack/prompts";
import {
	Apply,
	ApplyError,
	type ApplyOptions,
	type ApplyPlan,
	ConfigStore,
	type DiscoveredModule,
	formatApplyError,
	type InstallRecord,
	isPackageManager,
	LONG_RUNNING_TIMEOUT_MS,
	type Manifest,
	type PackageManager,
	Planner,
	packageManagerCommand,
	readPersistedCommandVersions,
	runtimeCommand,
	State,
	Subprocess,
} from "@ryuujs/core";
import {
	backends,
	type ForgeConfig,
	importRegistryPackage,
	loadDefinitionRegistry,
	probeWorkspaceCommandVersions,
	RegistryLoadError,
} from "@ryuujs/generators";
import { Effect, Exit, FileSystem, Result, Schema } from "effect";
import {
	type CliServices,
	failureFromCause,
	runCliEffect,
	runCliEffectValue,
} from "../runtime";
import {
	canResolveInteractively,
	isInteractiveLifecycleSession,
	promptForConflictResolutions,
} from "./interactive-resolution";

const ProjectPackageJsonSchema = Schema.fromJsonString(
	Schema.Struct({
		devDependencies: Schema.optional(
			Schema.Record(Schema.String, Schema.Unknown),
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
	effect: Effect.Effect<A, E, CliServices>,
	failureMessage: string,
): Promise<A> {
	const exit = await runCliEffect(effect);
	if (Exit.isSuccess(exit)) return exit.value;

	return reportLifecycleFailure(failureFromCause(exit.cause), failureMessage);
}

function reportLifecycleFailure(
	failure: { readonly message: string },
	failureMessage: string,
): never {
	const detail =
		failure instanceof ApplyError ? formatApplyError(failure) : failure.message;
	log.error(
		`${failureMessage} ${detail.endsWith(".") ? detail.slice(0, -1) : detail}.`,
	);

	process.exit(1);
}

export async function applyLifecyclePlan(
	projectRoot: string,
	plan: ApplyPlan,
	options: ApplyOptions,
): Promise<void> {
	const apply = (applyOptions: ApplyOptions) =>
		Apply.applyPlan(projectRoot, plan, applyOptions);

	const exit = await runCliEffect(apply(options));
	if (Exit.isSuccess(exit)) return;

	const failure = failureFromCause(exit.cause);
	if (
		failure instanceof ApplyError &&
		isInteractiveLifecycleSession() &&
		canResolveInteractively(failure, options)
	) {
		const resolution = await promptForConflictResolutions(failure);
		const retry = await runCliEffect(
			apply({ ...options, ...resolution.options }),
		);

		if (Exit.isSuccess(retry)) {
			log.success(resolution.summary);
			return;
		}

		return reportLifecycleFailure(
			failureFromCause(retry.cause),
			"We couldn't apply this change.",
		);
	}

	return reportLifecycleFailure(failure, "We couldn't apply this change.");
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
				error.reason === "manifest-missing" ? Effect.void : Effect.fail(error),
			),
		),
		"We couldn't read this project's Forge metadata.",
	);

	if (manifest === undefined) {
		log.error(lifecycleUnavailableMessage());
		process.exit(1);
	}

	const modules = await runLifecycleEffect(
		ConfigStore.discover(absoluteProjectRoot),
		"We couldn't read this project's modules.",
	);

	if (Object.keys(manifest.config).length === 0) {
		log.error(lifecycleUnavailableMessage());
		process.exit(1);
	}

	const backend = backends.normalize(manifest.config.backend);
	const config =
		backend === undefined ? manifest.config : { ...manifest.config, backend };

	const normalizedManifest = { ...manifest, config };

	return {
		config,
		manifest: normalizedManifest,
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
			const packageJson = yield* Schema.decodeEffect(ProjectPackageJsonSchema)(
				raw,
			);

			return (
				packageJson.devDependencies !== undefined &&
				Object.hasOwn(packageJson.devDependencies, packageId)
			);
		}),
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
	const exit = await runCliEffect(
		Subprocess.run({
			command: operation.command,
			args: operation.args,
			cwd: projectRoot,
			timeoutMs: LONG_RUNNING_TIMEOUT_MS,
			outputMode: "pipe",
		}),
	);

	return Exit.isSuccess(exit);
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
	const manifestResult = await runCliEffectValue(
		State.readManifest(absoluteProjectRoot).pipe(
			Effect.catchTag("StateError", (error) =>
				error.reason === "manifest-missing" ? Effect.void : Effect.fail(error),
			),
			Effect.result,
		),
	);

	if (Result.isFailure(manifestResult)) {
		log.warn(
			discoveryWarning(
				"read this project's Forge metadata",
				manifestResult.failure,
			),
			{ output: process.stderr },
		);

		return loadDefinitionRegistry();
	}

	const registryIds = manifestResult.success?.registries ?? [];
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
	options: ApplyOptions = {},
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
		}),
		"We couldn't plan this change.",
	);

	await applyLifecyclePlan(
		projectRoot,
		{
			lockfile: plan.lockfile,
			manifest: plan.manifest,
			removals: plan.removals,
			writes: plan.writes.map((write) => ({
				artifactId: write.artifactId,
				content: write.content,
				path: write.path,
			})),
		},
		options,
	);
}
