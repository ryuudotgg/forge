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
import { loadDefinitionRegistry } from "@ryuujs/generators";
import { Cause, Effect, Exit, Layer, Option } from "effect";

const coreLayer = CoreLive.pipe(Layer.provideMerge(NodeContext.layer));

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
		const detail = failure.value.message;
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
