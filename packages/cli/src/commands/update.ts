import { intro, log } from "@clack/prompts";
import { Context, Effect, Layer } from "effect";
import {
	applyInstalledPlan,
	loadManagedProject,
	loadProjectRegistry,
	type ManagedProject,
} from "./lifecycle";
import { resolutionArguments } from "./resolution";

export interface UpdateCommandService {
	readonly applyInstalledPlan: typeof applyInstalledPlan;
	readonly intro: typeof intro;
	readonly loadManagedProject: typeof loadManagedProject;
	readonly loadProjectRegistry: typeof loadProjectRegistry;
	readonly logInfo: typeof log.info;
}

export class UpdateCommand extends Context.Service<
	UpdateCommand,
	UpdateCommandService
>()("@ryuujs/forge/UpdateCommand") {
	static readonly Default = Layer.succeed(
		UpdateCommand,
		UpdateCommand.of({
			applyInstalledPlan,
			intro,
			loadManagedProject,
			loadProjectRegistry,
			logInfo: log.info,
		}),
	);
}

export function runUpdateEffect(
	values: Record<string, string | boolean | undefined>,
) {
	return Effect.gen(function* () {
		const command = yield* UpdateCommand;
		const resolution = resolutionArguments(values);
		command.intro("We're reconciling your installed addons and templates...");

		const project: ManagedProject = yield* Effect.promise(() =>
			command.loadManagedProject(".", "update"),
		);

		const loadedRegistry = yield* Effect.promise(() =>
			command.loadProjectRegistry(
				project.projectRoot,
				project.manifest.registries ?? [],
			),
		);

		yield* Effect.promise(() =>
			command.applyInstalledPlan(
				project.projectRoot,
				project.config,
				project.manifest.installs,
				undefined,
				project.manifest.registries,
				...resolution,
			),
		);

		for (const descriptor of loadedRegistry.descriptors) {
			const previous = project.manifest.registryDescriptors?.find(
				(entry) => entry.id === descriptor.id,
			);

			if (previous !== undefined && previous.version !== descriptor.version)
				command.logInfo(
					`${descriptor.id} ${previous.version} -> ${descriptor.version}.`,
				);
		}
	});
}

export async function runUpdate(
	values: Record<string, string | boolean | undefined>,
	layer: Layer.Layer<UpdateCommand>,
) {
	await Effect.runPromise(runUpdateEffect(values).pipe(Effect.provide(layer)));
}
