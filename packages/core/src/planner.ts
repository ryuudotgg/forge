import { Effect } from "effect";
import type {
	AddonDefinition,
	Contribution,
	DefinitionRegistry,
	EnsureModuleContribution,
	TargetRef,
	TemplateDefinition,
} from "./authoring";
import { isAddonCompatibleWithModule } from "./authoring";
import {
	type Config,
	ConfigStore,
	type DiscoveredModule,
	type ModuleId,
} from "./config";
import { AggregateConflictError, GeneratorError, PlannerError } from "./errors";
import { formatJson } from "./format/json";
import { type FileOperation, filePath } from "./operations";
import {
	type RenderBucket,
	type RenderedArtifact,
	Renderer,
	type SurfaceRenderContribution,
} from "./renderer";
import {
	buildProvenanceIndex,
	type InstallRecord,
	type InstallTarget,
	type Lockfile,
	type Manifest,
	type ModuleRecord,
	type ProvenanceArtifact,
	State,
} from "./state";
import { Vfs } from "./virtual-fs";

type Definition<ConfigValue> =
	| TemplateDefinition<ConfigValue>
	| AddonDefinition<ConfigValue>;

interface EvaluatedDefinition<ConfigValue> {
	readonly definition: Definition<ConfigValue>;
	readonly contributions: ReadonlyArray<Contribution>;
	readonly order: number;
}

interface ManagedModuleRecord {
	config: Config;
	readonly definitionIds: ReadonlyArray<string>;
	readonly id: ModuleId;
	readonly root: string;
}

interface PlanIntentCreate<ConfigValue> {
	readonly _tag: "Create";
	readonly config: ConfigValue;
}

interface PlanIntentInstalled<ConfigValue> {
	readonly _tag: "Installed";
	readonly config: ConfigValue;
	readonly installs: ReadonlyArray<InstallRecord>;
}

type PlanIntent<ConfigValue> =
	| PlanIntentCreate<ConfigValue>
	| PlanIntentInstalled<ConfigValue>;

export interface PlannedFile {
	readonly content: string;
	readonly definitionIds: ReadonlyArray<string>;
	readonly kind: "file" | "surface";
	readonly path: string;
	readonly target: RenderBucket;
	readonly targetKey: string;
}

export interface ProjectPlan {
	readonly lockfile: Lockfile;
	readonly manifest: Manifest;
	readonly removals: ReadonlyArray<string>;
	readonly writes: ReadonlyArray<PlannedFile>;
}

function isTemplate<ConfigValue>(
	definition: Definition<ConfigValue>,
): definition is TemplateDefinition<ConfigValue> {
	return definition._tag === "TemplateDefinition";
}

function definitionKey<ConfigValue>(definition: Definition<ConfigValue>) {
	return `${definition._tag}:${definition.id}`;
}

function definitionVersion<ConfigValue>(definition: Definition<ConfigValue>) {
	return isTemplate(definition)
		? String(definition.version)
		: definition.version;
}

function templateMatchesId(templateId: string, moduleTemplateId: string) {
	return (
		templateId === moduleTemplateId ||
		templateId.endsWith(`/${moduleTemplateId}`)
	);
}

function cloneModule(
	module: DiscoveredModule,
	record?: ModuleRecord,
): ManagedModuleRecord {
	return {
		config:
			module.type === "app"
				? {
						id: module.id,
						type: "app",
						framework: module.framework,
						template: module.template,
						slots: { ...module.slots },
					}
				: {
						id: module.id,
						type: "package",
						packageType: module.packageType,
						template: module.template,
						capabilities: [...(module.capabilities ?? [])],
						slots: { ...module.slots },
					},
		definitionIds: [...(record?.definitionIds ?? [])],
		id: module.id,
		root: module.root,
	};
}

function mergeEnsuredModule(
	existing: ManagedModuleRecord | undefined,
	ensured: EnsureModuleContribution,
	moduleId: ModuleId,
	definitionId: string,
): Effect.Effect<ManagedModuleRecord, PlannerError> {
	const nextConfig = ensured.module;

	if (!existing)
		return Effect.succeed({
			config: { ...nextConfig, id: moduleId } as Config,
			definitionIds: [definitionId],
			id: moduleId,
			root: ensured.root,
		});

	if (existing.config.type !== nextConfig.type)
		return Effect.fail(
			new PlannerError({
				path: ensured.root,
				message: "Ensured Module Type Conflict",
			}),
		);

	if (existing.config.type === "app" && nextConfig.type === "app") {
		if (
			existing.config.framework !== nextConfig.framework ||
			existing.config.template.id !== nextConfig.template.id ||
			existing.config.template.version !== nextConfig.template.version
		)
			return Effect.fail(
				new PlannerError({
					path: ensured.root,
					message: "Ensured App Module Conflict",
				}),
			);

		return Effect.succeed({
			config: {
				...nextConfig,
				id: existing.id,
				slots: { ...nextConfig.slots, ...existing.config.slots },
				type: "app",
			},
			definitionIds: [...new Set([...existing.definitionIds, definitionId])],
			id: existing.id,
			root: existing.root,
		});
	}

	if (existing.config.type === "package" && nextConfig.type === "package") {
		if (
			existing.config.packageType !== nextConfig.packageType ||
			existing.config.template.id !== nextConfig.template.id ||
			existing.config.template.version !== nextConfig.template.version
		)
			return Effect.fail(
				new PlannerError({
					path: ensured.root,
					message: "Ensured Package Module Conflict",
				}),
			);

		return Effect.succeed({
			config: {
				...nextConfig,
				capabilities: [
					...new Set([
						...(nextConfig.capabilities ?? []),
						...(existing.config.capabilities ?? []),
					]),
				],
				id: existing.id,
				slots: { ...nextConfig.slots, ...existing.config.slots },
				type: "package",
			},
			definitionIds: [...new Set([...existing.definitionIds, definitionId])],
			id: existing.id,
			root: existing.root,
		});
	}

	return Effect.fail(
		new PlannerError({
			path: ensured.root,
			message: "Ensured Module Conflict",
		}),
	);
}

function normalizeContributionResult<ConfigValue>(
	definition: Definition<ConfigValue>,
	result:
		| ReadonlyArray<Contribution>
		| Promise<ReadonlyArray<Contribution>>
		| Effect.Effect<ReadonlyArray<Contribution>, GeneratorError, never>,
): Effect.Effect<ReadonlyArray<Contribution>, GeneratorError> {
	if (Effect.isEffect(result)) return result;
	if (result instanceof Promise)
		return Effect.tryPromise({
			try: () => result,
			catch: (error) =>
				new GeneratorError({
					generatorId: definition.id,
					message: `Definition Failed: ${error instanceof Error ? error.message : String(error)}`,
				}),
		});
	return Effect.succeed(result);
}

function createFileOp(path: string, content: string): FileOperation {
	return { _tag: "CreateFile", path: filePath(path), content };
}

function isProjectTarget(target: InstallTarget) {
	return target.kind === "project";
}

function installTargetKey(target: InstallTarget) {
	return isProjectTarget(target) ? "project" : `module:${target.moduleId}`;
}

function buildTargetCandidates(
	addon: AddonDefinition<Record<string, unknown>>,
	modules: ReadonlyArray<ManagedModuleRecord>,
): ReadonlyArray<InstallTarget> {
	if (!addon.compatibility) return [{ kind: "project" }];

	const compatibleModules = modules
		.filter((module) =>
			isAddonCompatibleWithModule(
				addon as AddonDefinition<Record<string, unknown>>,
				module.config,
			),
		)
		.map((module) => ({ kind: "module", moduleId: module.id }) as const);

	if (addon.targetMode === "single")
		return compatibleModules[0] ? [compatibleModules[0]] : [];

	return compatibleModules;
}

function mergeInstallRecords(installs: ReadonlyArray<InstallRecord>) {
	const records = new Map<string, InstallTarget[]>();

	for (const install of installs) {
		const existing = records.get(install.definitionId) ?? [];
		const next = [...existing];

		for (const target of install.targets) {
			const key = installTargetKey(target);
			if (next.some((entry) => installTargetKey(entry) === key)) continue;
			next.push(target);
		}

		records.set(install.definitionId, next);
	}

	return [...records.entries()].map(([definitionId, targets]) => ({
		definitionId,
		targets,
	}));
}

export class Planner extends Effect.Service<Planner>()("Planner", {
	accessors: false,
	effect: Effect.gen(function* () {
		const configStore = yield* ConfigStore;
		const renderer = yield* Renderer;
		const state = yield* State;
		const vfs = yield* Vfs;

		const resolveCreateSelection = <ConfigValue>(
			config: ConfigValue,
			registry: DefinitionRegistry<ConfigValue>,
		) => {
			const template = registry.templates.filter((entry) => entry.when(config));
			if (template.length > 1)
				return Effect.fail(
					new PlannerError({
						path: "registry",
						message: "Multiple Templates Selected",
					}),
				);

			const directAddons = registry.addons.filter((entry) =>
				entry.when(config),
			);
			return Effect.succeed({
				directAddons,
				templates: template,
			});
		};

		const resolveDependencies = <ConfigValue>(
			registry: DefinitionRegistry<ConfigValue>,
			templates: ReadonlyArray<TemplateDefinition<ConfigValue>>,
			addons: ReadonlyArray<AddonDefinition<ConfigValue>>,
		) =>
			Effect.gen(function* () {
				const templateById = new Map(
					registry.templates.map((template) => [template.id, template]),
				);
				const addonById = new Map(
					registry.addons.map((addon) => [addon.id, addon]),
				);

				const resolved = new Map<string, Definition<ConfigValue>>();

				const visit = (
					definition: Definition<ConfigValue>,
				): Effect.Effect<void, PlannerError> =>
					Effect.gen(function* () {
						const key = definitionKey(definition);
						if (resolved.has(key)) return;

						resolved.set(key, definition);

						for (const dependency of definition.dependencies) {
							const dependencyDefinition =
								dependency.type === "template"
									? templateById.get(dependency.id)
									: addonById.get(dependency.id);

							if (!dependencyDefinition)
								return yield* new PlannerError({
									path: definition.id,
									message: "Definition Dependency Missing",
								});

							yield* visit(dependencyDefinition);
						}
					});

				for (const template of templates) yield* visit(template);
				for (const addon of addons) yield* visit(addon);

				return [...resolved.values()];
			});

		const orderDefinitions = <ConfigValue>(
			definitions: ReadonlyArray<Definition<ConfigValue>>,
		) => {
			const byId = new Map(
				definitions.map((definition) => [definition.id, definition]),
			);
			const visited = new Set<string>();
			const visiting = new Set<string>();
			const ordered: Definition<ConfigValue>[] = [];

			const visit = (
				definition: Definition<ConfigValue>,
			): Effect.Effect<void, PlannerError> =>
				Effect.gen(function* () {
					if (visited.has(definitionKey(definition))) return;
					if (visiting.has(definitionKey(definition)))
						return yield* new PlannerError({
							path: definition.id,
							message: "Definition Cycle Detected",
						});

					visiting.add(definitionKey(definition));

					for (const dependency of definition.dependencies) {
						const next = byId.get(dependency.id);
						if (!next) continue;
						yield* visit(next);
					}

					visiting.delete(definitionKey(definition));
					visited.add(definitionKey(definition));
					ordered.push(definition);
				});

			return Effect.gen(function* () {
				for (const definition of definitions) yield* visit(definition);
				return ordered;
			});
		};

		const evaluateDefinitions = Effect.fn("Planner.evaluateDefinitions")(
			function* <ConfigValue extends Record<string, unknown>>(
				config: ConfigValue,
				definitions: ReadonlyArray<Definition<ConfigValue>>,
			) {
				const ordered = yield* orderDefinitions(definitions);

				return yield* Effect.forEach(ordered, (definition, order) =>
					normalizeContributionResult(
						definition,
						definition.contribute({ config }) as
							| ReadonlyArray<Contribution>
							| Promise<ReadonlyArray<Contribution>>
							| Effect.Effect<
									ReadonlyArray<Contribution>,
									GeneratorError,
									never
							  >,
					).pipe(
						Effect.map(
							(contributions) =>
								({
									contributions,
									definition,
									order,
								}) satisfies EvaluatedDefinition<ConfigValue>,
						),
					),
				);
			},
		);

		const collectModules = Effect.fn("Planner.collectModules")(function* (
			discovered: ReadonlyArray<DiscoveredModule>,
			existingModules: Manifest["modules"],
			evaluated: ReadonlyArray<EvaluatedDefinition<Record<string, unknown>>>,
		) {
			const activeDefinitionIds = new Set(
				evaluated.map((entry) => entry.definition.id),
			);
			const byRoot = new Map(
				discovered.flatMap((module) => {
					const existing = existingModules[module.id];
					const definitionIds = existing?.definitionIds ?? [];
					const keepDiscovered =
						definitionIds.length === 0 ||
						definitionIds.some((definitionId) =>
							activeDefinitionIds.has(definitionId),
						);

					return keepDiscovered
						? [[module.root, cloneModule(module, existing)]]
						: [];
				}),
			);
			const byKey = new Map<string, ModuleId>();
			const usedIds = new Set(discovered.map((module) => module.id));

			for (const entry of evaluated)
				for (const contribution of entry.contributions)
					if (contribution._tag === "EnsureModuleContribution") {
						const existing = byRoot.get(contribution.root);
						const moduleId = existing
							? existing.id
							: yield* configStore.generateId(usedIds);

						usedIds.add(moduleId);
						const merged = yield* mergeEnsuredModule(
							existing,
							contribution,
							moduleId,
							entry.definition.id,
						);
						byRoot.set(contribution.root, merged);
						byKey.set(contribution.moduleKey, merged.id);
					}

			return {
				modules: [...byRoot.values()],
				moduleIdsByKey: byKey,
			};
		});

		const resolveModuleTargets = (
			target: TargetRef,
			definitionId: string,
			moduleIdsByKey: ReadonlyMap<string, ModuleId>,
			modules: ReadonlyArray<ManagedModuleRecord>,
			selectedTargets: ReadonlyMap<string, ReadonlyArray<InstallTarget>>,
		): Effect.Effect<ReadonlyArray<RenderBucket>, PlannerError> => {
			switch (target._tag) {
				case "ProjectTarget":
					return Effect.succeed([{ kind: "project" }]);
				case "SelectedModuleTarget": {
					const installTargets = selectedTargets.get(definitionId) ?? [];
					const moduleTargets = installTargets
						.filter((entry) => entry.kind === "module")
						.map(
							(entry) =>
								({
									kind: "module",
									moduleId: entry.moduleId,
								}) as const,
						);

					if (moduleTargets.length === 0)
						return Effect.fail(
							new PlannerError({
								path: definitionId,
								message: "Selected Target Missing",
							}),
						);

					return Effect.succeed(moduleTargets);
				}
				case "EnsuredModuleTarget": {
					const moduleId = moduleIdsByKey.get(target.moduleKey);
					if (!moduleId)
						return Effect.fail(
							new PlannerError({
								path: definitionId,
								message: "Ensured Module Missing",
							}),
						);

					return Effect.succeed([{ kind: "module", moduleId }]);
				}
				case "TemplateModuleTarget": {
					const matches = modules
						.filter(
							(module) =>
								templateMatchesId(
									target.template.id,
									module.config.template.id,
								) && module.config.template.version === target.template.version,
						)
						.map(
							(module) => ({ kind: "module", moduleId: module.id }) as const,
						);

					if (matches.length === 0)
						return Effect.fail(
							new PlannerError({
								path: definitionId,
								message: "Target Module Missing",
							}),
						);

					return Effect.succeed(matches);
				}
			}
		};

		const applyModuleCapabilities = Effect.fn(
			"Planner.applyModuleCapabilities",
		)(function* (
			evaluated: ReadonlyArray<EvaluatedDefinition<Record<string, unknown>>>,
			modules: ReadonlyArray<ManagedModuleRecord>,
			moduleIdsByKey: ReadonlyMap<string, ModuleId>,
			selectedTargets: ReadonlyMap<string, ReadonlyArray<InstallTarget>>,
		) {
			const byId = new Map(modules.map((module) => [module.id, module]));

			for (const entry of evaluated)
				for (const contribution of entry.contributions)
					if (contribution._tag === "ModuleCapabilitiesContribution") {
						const targets = yield* resolveModuleTargets(
							contribution.target,
							entry.definition.id,
							moduleIdsByKey,
							modules,
							selectedTargets,
						);

						for (const target of targets) {
							if (target.kind !== "module") continue;

							const module = byId.get(target.moduleId);
							if (!module || module.config.type !== "package") continue;

							module.config = {
								...module.config,
								capabilities: [
									...new Set([
										...(module.config.capabilities ?? []),
										...contribution.capabilities,
									]),
								],
							};
						}
					}

			return [...byId.values()];
		});

		const collectManagedSurfaceInputs = Effect.fn(
			"Planner.collectManagedSurfaceInputs",
		)(function* (
			evaluated: ReadonlyArray<EvaluatedDefinition<Record<string, unknown>>>,
			modules: ReadonlyArray<ManagedModuleRecord>,
			moduleIdsByKey: ReadonlyMap<string, ModuleId>,
			selectedTargets: ReadonlyMap<string, ReadonlyArray<InstallTarget>>,
		) {
			const collected: SurfaceRenderContribution[] = [];

			for (const entry of evaluated)
				for (const contribution of entry.contributions) {
					if (
						contribution._tag !== "ManagedTextSurfaceContribution" &&
						contribution._tag !== "ManagedJsonSurfaceContribution" &&
						contribution._tag !== "ManagedLinesSurfaceContribution" &&
						contribution._tag !== "ManagedDependenciesSurfaceContribution" &&
						contribution._tag !== "ManagedScriptsSurfaceContribution"
					)
						continue;

					const targets = yield* resolveModuleTargets(
						contribution.target,
						entry.definition.id,
						moduleIdsByKey,
						modules,
						selectedTargets,
					);

					for (const bucket of targets)
						collected.push({
							bucket,
							contribution,
							definitionId: entry.definition.id,
							order: entry.order,
						});
				}

			return collected;
		});

		const collectLeafFiles = Effect.fn("Planner.collectLeafFiles")(function* (
			evaluated: ReadonlyArray<EvaluatedDefinition<Record<string, unknown>>>,
			modules: ReadonlyArray<ManagedModuleRecord>,
			moduleIdsByKey: ReadonlyMap<string, ModuleId>,
			selectedTargets: ReadonlyMap<string, ReadonlyArray<InstallTarget>>,
		) {
			const byId = new Map(modules.map((module) => [module.id, module]));
			const bucketsByPath = new Map<string, RenderBucket>();
			let leafVfs = yield* vfs.empty();

			for (const entry of evaluated)
				for (const contribution of entry.contributions) {
					if (contribution._tag !== "LeafTextFileContribution") continue;

					const targets = yield* resolveModuleTargets(
						contribution.target,
						entry.definition.id,
						moduleIdsByKey,
						modules,
						selectedTargets,
					);

					for (const target of targets) {
						const relativePath =
							target.kind === "project"
								? contribution.path
								: `${byId.get(target.moduleId)?.root ?? ""}/${contribution.path}`;

						bucketsByPath.set(relativePath, target);
						leafVfs = yield* vfs.addOperations(leafVfs, entry.definition.id, [
							createFileOp(relativePath, contribution.content),
						]);
					}
				}

			return yield* vfs.resolve(leafVfs, { onConflict: "error" }).pipe(
				Effect.map((files) =>
					files.map((file) => ({
						...file,
						bucket: bucketsByPath.get(String(file.path)) ?? {
							kind: "project" as const,
						},
					})),
				),
				Effect.mapError((error) =>
					error instanceof AggregateConflictError
						? new PlannerError({
								path: "leaf-files",
								message: "Leaf File Conflict",
							})
						: new PlannerError({
								path: "leaf-files",
								message: "Leaf File Resolution Failed",
							}),
				),
			);
		});

		const buildManifest = Effect.fn("Planner.buildManifest")(function* (
			config: Record<string, unknown>,
			installs: ReadonlyArray<InstallRecord>,
			modules: ReadonlyArray<ManagedModuleRecord>,
		) {
			return {
				config,
				installs: mergeInstallRecords(installs),
				modules: Object.fromEntries(
					modules.map((module) => [
						module.id,
						{
							definitionIds: [...module.definitionIds],
							root: module.root,
						},
					]),
				),
			} satisfies Manifest;
		});

		const hashString = Effect.fn("Planner.hashString")(function* (
			content: string,
		) {
			const encoder = new TextEncoder();
			const data = encoder.encode(content);

			const buffer = yield* Effect.tryPromise({
				try: () => globalThis.crypto.subtle.digest("SHA-256", data),
				catch: () =>
					new PlannerError({
						path: "content",
						message: "Content Hash Failed",
					}),
			});

			return Array.from(new Uint8Array(buffer))
				.map((byte) => byte.toString(16).padStart(2, "0"))
				.join("");
		});

		const buildLockfile = Effect.fn("Planner.buildLockfile")(function* (
			definitions: ReadonlyArray<Definition<Record<string, unknown>>>,
			managedModules: ReadonlyArray<ManagedModuleRecord>,
			renderedSurfaces: ReadonlyArray<RenderedArtifact>,
			leafFiles: ReadonlyArray<{
				readonly bucket: RenderBucket;
				readonly content: string;
				readonly generators: ReadonlyArray<string>;
				readonly path: ReturnType<typeof filePath>;
			}>,
		) {
			const artifacts: Record<string, ProvenanceArtifact> = {};

			for (const artifact of renderedSurfaces) {
				const hash = yield* hashString(artifact.content);
				const targetKey =
					artifact.bucket.kind === "project"
						? "project"
						: `module:${artifact.bucket.moduleId}`;

				artifacts[`${targetKey}:surface:${artifact.key}`] = {
					definitionIds: [...artifact.definitionIds],
					hash,
					kind: "surface",
					path: artifact.path,
					target: artifact.bucket,
				};
			}

			for (const module of managedModules) {
				const hash = yield* hashString(
					formatJson(module.config, { compact: false }),
				);
				const path = `${module.root}/forge.json`;
				artifacts[`module:${module.id}:file:forge.json`] = {
					definitionIds: [...module.definitionIds],
					hash,
					kind: "file",
					path,
					target: { kind: "module", moduleId: module.id },
				};
			}

			for (const file of leafFiles) {
				const hash = yield* hashString(file.content);
				const path = String(file.path);
				const targetKey =
					file.bucket.kind === "project"
						? "project"
						: `module:${file.bucket.moduleId}`;

				artifacts[`${targetKey}:file:${path}`] = {
					definitionIds: [...file.generators],
					hash,
					kind: "file",
					path,
					target: file.bucket,
				};
			}

			return {
				resolutions: Object.fromEntries(
					definitions.map((definition) => [
						definition.id,
						definitionVersion(definition),
					]),
				),
				provenance: { artifacts },
			} satisfies Lockfile;
		});

		const buildWrites = (
			modules: ReadonlyArray<ManagedModuleRecord>,
			renderedSurfaces: ReadonlyArray<RenderedArtifact>,
			leafFiles: ReadonlyArray<{
				readonly bucket: RenderBucket;
				readonly content: string;
				readonly generators: ReadonlyArray<string>;
				readonly path: ReturnType<typeof filePath>;
			}>,
		) =>
			Effect.sync(() => {
				const writes: PlannedFile[] = [];

				for (const module of modules)
					writes.push({
						content: formatJson(module.config, { compact: false }),
						definitionIds: [module.config.template.id],
						kind: "file",
						path: `${module.root}/forge.json`,
						target: { kind: "module", moduleId: module.id },
						targetKey: `${module.id}:forge.json`,
					});

				for (const artifact of renderedSurfaces)
					writes.push({
						content: artifact.content,
						definitionIds: artifact.definitionIds,
						kind: "surface",
						path: artifact.path,
						target: artifact.bucket,
						targetKey:
							artifact.bucket.kind === "project"
								? artifact.key
								: `${artifact.bucket.moduleId}:${artifact.key}`,
					});

				for (const file of leafFiles)
					writes.push({
						content: file.content,
						definitionIds: file.generators,
						kind: "file",
						path: String(file.path),
						target: file.bucket,
						targetKey:
							file.bucket.kind === "project"
								? String(file.path)
								: `${file.bucket.moduleId}:${String(file.path)}`,
					});

				const deduped = new Map<string, PlannedFile>();
				for (const write of writes) deduped.set(write.path, write);
				return [...deduped.values()];
			});

		const plan = Effect.fn("Planner.plan")(function* <
			ConfigValue extends Record<string, unknown>,
		>(
			projectRoot: string,
			registry: DefinitionRegistry<ConfigValue>,
			intent: PlanIntent<ConfigValue>,
		) {
			const discovered = yield* configStore.discover(projectRoot);
			const existingManifest = yield* state.readManifest(projectRoot).pipe(
				Effect.catchAll(() =>
					Effect.succeed({
						config: {},
						installs: [],
						modules: {},
					} satisfies Manifest),
				),
			);
			const existingLockfile = yield* state.readLockfile(projectRoot);

			const selection =
				intent._tag === "Create" || intent.installs.length === 0
					? yield* resolveCreateSelection(intent.config, registry)
					: {
							directAddons: registry.addons.filter((addon) =>
								intent.installs.some(
									(install) => install.definitionId === addon.id,
								),
							),
							templates: registry.templates.filter((template) =>
								discovered.some(
									(module) =>
										module.type === "app" &&
										module.framework === template.framework &&
										templateMatchesId(template.id, module.template.id) &&
										module.template.version === template.version,
								),
							),
						};

			const definitions = yield* resolveDependencies(
				registry,
				selection.templates,
				selection.directAddons,
			);
			const evaluated = yield* evaluateDefinitions(
				intent.config as Record<string, unknown>,
				definitions as ReadonlyArray<Definition<Record<string, unknown>>>,
			);

			const { moduleIdsByKey, modules: mergedModules } = yield* collectModules(
				discovered,
				existingManifest.modules,
				evaluated,
			);

			const defaultCreateInstalls =
				intent._tag === "Create" || intent.installs.length === 0
					? selection.directAddons.map((addon) => ({
							definitionId: addon.id,
							targets: buildTargetCandidates(
								addon as AddonDefinition<Record<string, unknown>>,
								mergedModules,
							),
						}))
					: intent.installs;

			for (const install of defaultCreateInstalls) {
				const addon = registry.addons.find(
					(entry) => entry.id === install.definitionId,
				);
				if (!addon)
					return yield* new PlannerError({
						path: install.definitionId,
						message: "Definition Missing",
					});

				if (addon.targetMode === "single" && install.targets.length > 1)
					return yield* new PlannerError({
						path: install.definitionId,
						message: "Multiple Targets Selected",
					});
			}

			const selectedTargets = new Map(
				defaultCreateInstalls.map((install) => [
					install.definitionId,
					install.targets,
				]),
			);

			const modules = yield* applyModuleCapabilities(
				evaluated,
				mergedModules,
				moduleIdsByKey,
				selectedTargets,
			);

			const managedInputs = yield* collectManagedSurfaceInputs(
				evaluated,
				modules,
				moduleIdsByKey,
				selectedTargets,
			);
			const renderedSurfaces = yield* renderer.render(
				managedInputs,
				modules.map((module) => ({ ...module.config, root: module.root })),
			);
			const leafFiles = yield* collectLeafFiles(
				evaluated,
				modules,
				moduleIdsByKey,
				selectedTargets,
			);

			const writes = yield* buildWrites(modules, renderedSurfaces, leafFiles);
			const manifest = yield* buildManifest(
				intent.config as Record<string, unknown>,
				defaultCreateInstalls.filter((install) => install.targets.length > 0),
				modules,
			);
			const lockfile = yield* buildLockfile(
				definitions as ReadonlyArray<Definition<Record<string, unknown>>>,
				modules,
				renderedSurfaces,
				leafFiles,
			);

			const previousPaths = new Set(
				buildProvenanceIndex(existingLockfile).byPath.keys(),
			);
			const nextPaths = new Set(writes.map((write) => write.path));
			const removals = [...previousPaths].filter(
				(path) => !nextPaths.has(path),
			);

			return {
				lockfile,
				manifest: {
					...existingManifest,
					...manifest,
				},
				removals,
				writes,
			} satisfies ProjectPlan;
		});

		const planCreate = Effect.fn("Planner.planCreate")(function* <
			ConfigValue extends Record<string, unknown>,
		>(
			projectRoot: string,
			config: ConfigValue,
			registry: DefinitionRegistry<ConfigValue>,
		) {
			return yield* plan(projectRoot, registry, { _tag: "Create", config });
		});

		const planInstalled = Effect.fn("Planner.planInstalled")(function* <
			ConfigValue extends Record<string, unknown>,
		>(
			projectRoot: string,
			config: ConfigValue,
			installs: ReadonlyArray<InstallRecord>,
			registry: DefinitionRegistry<ConfigValue>,
		) {
			return yield* plan(projectRoot, registry, {
				_tag: "Installed",
				config,
				installs,
			});
		});

		return { planCreate, planInstalled };
	}),
}) {}
