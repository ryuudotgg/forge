import { intro, log } from "@clack/prompts";
import { type ReferenceHit, trackedFiles } from "@ryuugg/core";
import type { ForgeConfig } from "@ryuugg/generators";
import { Context, Effect, Layer } from "effect";
import {
	configIssue,
	malformedConfigIssue,
	ormIssue,
	webAppConfigShapeIssue,
} from "../config/schema";
import { runCliEffectValue } from "../runtime";
import {
	applyInstalledPlan,
	loadManagedProject,
	loadProjectRegistry,
	type ManagedProject,
} from "./lifecycle";
import { resolutionArguments } from "./resolution";
import { secondaryAppModules } from "./secondary-apps";
import {
	checkWebAppRenames,
	directoryMoves,
	pairWebAppRenames,
	renamedModules,
	renameInstallHint,
	renameReport,
	scanRenameReferences,
	type WebAppRename,
	webAppRenameNameIssue,
} from "./web-app-renames";

export interface UpdateCommandService {
	readonly checkRenames: (
		root: string,
		renames: ReadonlyArray<WebAppRename>,
		config: ForgeConfig,
		modules: ManagedProject["modules"],
	) => Promise<string | undefined>;
	readonly scanReferences: (
		root: string,
		renames: ReadonlyArray<WebAppRename>,
		modules: ManagedProject["modules"],
	) => Promise<ReadonlyArray<ReferenceHit>>;
	readonly existingPaths: (root: string) => Promise<ReadonlyArray<string>>;
	readonly installHint: (
		root: string,
		config: ForgeConfig,
	) => Promise<string | undefined>;
	readonly applyInstalledPlan: typeof applyInstalledPlan;
	readonly intro: typeof intro;
	readonly loadManagedProject: typeof loadManagedProject;
	readonly loadProjectRegistry: typeof loadProjectRegistry;
	readonly logInfo: typeof log.info;
	readonly logWarn: typeof log.warn;
	readonly logError: typeof log.error;
}

export class UpdateCommand extends Context.Service<
	UpdateCommand,
	UpdateCommandService
>()("@ryuugg/forge/UpdateCommand") {
	static readonly Default = Layer.succeed(
		UpdateCommand,
		UpdateCommand.of({
			checkRenames: (root, renames, config, modules) =>
				runCliEffectValue(checkWebAppRenames(root, renames, config, modules)),
			scanReferences: (root, renames, modules) =>
				runCliEffectValue(scanRenameReferences(root, renames, modules)),
			existingPaths: (root) => runCliEffectValue(trackedFiles(root)),
			installHint: (root, config) =>
				runCliEffectValue(renameInstallHint(root, config)),
			applyInstalledPlan,
			intro,
			loadManagedProject,
			loadProjectRegistry,
			logInfo: log.info,
			logWarn: log.warn,
			logError: log.error,
		}),
	);
}

export function runUpdateEffect(
	values: Record<string, string | boolean | string[] | undefined>,
) {
	return Effect.gen(function* () {
		const command = yield* UpdateCommand;
		const resolution = resolutionArguments(values);
		command.intro("We're reconciling your installed addons and templates...");

		const project: ManagedProject = yield* Effect.promise(() =>
			command.loadManagedProject(".", "update"),
		);

		const shapeIssue = webAppConfigShapeIssue(project.config);
		if (shapeIssue !== undefined) {
			command.logError(shapeIssue);
			process.exit(1);
		}

		const paired = pairWebAppRenames(
			project.config,
			project.modules,
			project.manifest.modules,
		);

		if ("message" in paired) {
			command.logError(paired.message);
			process.exit(1);
		}

		const renames = paired;
		const issue =
			webAppRenameNameIssue(renames) ??
			malformedConfigIssue(project.config) ??
			configIssue(project.config) ??
			ormIssue(project.config);

		if (issue !== undefined) {
			command.logError(issue);
			process.exit(1);
		}

		if (renames.length > 0) {
			const refusal = yield* Effect.promise(() =>
				command.checkRenames(
					project.projectRoot,
					renames,
					project.config,
					project.modules,
				),
			);

			if (refusal !== undefined) {
				command.logError(refusal);
				process.exit(1);
			}
		}

		const before =
			renames.length === 0
				? []
				: yield* Effect.promise(() =>
						command.scanReferences(
							project.projectRoot,
							renames,
							project.modules,
						),
					);

		const loadedRegistry = yield* Effect.promise(() =>
			command.loadProjectRegistry(
				project.projectRoot,
				project.manifest.registries ?? [],
			),
		);

		if (renames.length === 0)
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
		else
			yield* Effect.promise(() =>
				command.applyInstalledPlan(
					project.projectRoot,
					project.config,
					project.manifest.installs,
					undefined,
					project.manifest.registries,
					resolution[0] ?? {},
					{
						modules: project.modules,
						records: project.manifest.modules,
						directoryMoves: directoryMoves(renames),
					},
				),
			);

		const modules = renamedModules(project.modules, renames);

		if (renames.length > 0) {
			const scanned = yield* Effect.tryPromise(async () => ({
				after: await command.scanReferences(
					project.projectRoot,
					renames,
					modules,
				),
				paths: await command.existingPaths(project.projectRoot),
			})).pipe(
				Effect.catch(() => {
					command.logWarn(
						"We couldn't check the remaining app references. Check your files for the old app names.",
					);

					return Effect.succeed(undefined);
				}),
			);

			const report = renameReport(
				renames,
				scanned === undefined ? [] : before,
				scanned?.after ?? [],
				new Set(scanned?.paths ?? []),
			);

			for (const sentence of report.info) command.logInfo(sentence);
			for (const sentence of report.warnings) command.logWarn(sentence);

			const hint = yield* Effect.promise(() =>
				command.installHint(project.projectRoot, project.config),
			);

			if (hint !== undefined) command.logInfo(hint);
		}

		const config: ForgeConfig = project.config;
		for (const app of config.webApps ?? [])
			if (secondaryAppModules({ ...project, modules }, app).length === 0)
				command.logWarn(
					`We skipped the ${app.name} web app because its folder is missing. Run forge remove ${app.name} to drop it from your config.`,
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
	values: Record<string, string | boolean | string[] | undefined>,
	layer: Layer.Layer<UpdateCommand>,
) {
	await Effect.runPromise(runUpdateEffect(values).pipe(Effect.provide(layer)));
}
