import { Context, Effect, Layer, Result } from "effect";
import type {
	AdapterDefinition,
	AddonDefinition,
	Contribution,
	DefinitionRegistry,
	EnsuredModuleTarget,
	EnsureModuleContribution,
	ModuleTarget,
	ResolvedModuleTarget,
	SlotPath,
	TargetRef,
	TemplateDefinition,
} from "./authoring";
import {
	addonDeclaresFramework,
	isAddonCompatibleWithModule,
	resolveSlotPath,
	validateAddonAgainstSelection,
} from "./authoring";
import { CommandProbe } from "./command";
import {
	type Config,
	ConfigStore,
	type DiscoveredModule,
	type ModuleId,
	type Slots,
} from "./config";
import { dependencyFormatFor } from "./environment";
import {
	type GeneratorError,
	PlannerError,
	type RendererError,
} from "./errors";
import { formatJson } from "./format/json";
import { hashContentHex } from "./hash";
import { filePath } from "./operations";
import {
	type Definition,
	definitionKey,
	type EvaluatedDefinition,
	type EvaluationPhaseContract,
	evaluateAdapters,
	evaluateDefinitions,
	type ManagedModuleRecord,
	type PlannerReasons,
	type SelectionPhaseContract,
	type TargetedLeafFile,
	type TargetingPhaseContract,
} from "./planner-evaluation";
import {
	type RenderBucket,
	type RenderedArtifact,
	Renderer,
	type SurfaceRenderContribution,
} from "./renderer";
import {
	type InstallRecord,
	type InstallTarget,
	type Lockfile,
	type LockfileArtifact,
	type Manifest,
	type ModuleRecord,
	type RegistryDescriptor,
	State,
	SURFACE_MERGE_SEMANTICS_VERSION,
} from "./state";

function retargetAdoptedTarget(
	target: TargetRef,
	moduleKey: string,
	module: DiscoveredModule,
): TargetRef {
	if (target._tag !== "EnsuredModuleTarget" || target.moduleKey !== moduleKey)
		return target;

	return {
		_tag: "ResolvedModuleTarget",
		moduleId: module.id,
		moduleRoot: module.root,
	};
}

function retargetAdoptedModuleTarget(
	target: ModuleTarget,
	moduleKey: string,
	module: DiscoveredModule,
): ModuleTarget {
	if (target._tag !== "EnsuredModuleTarget" || target.moduleKey !== moduleKey)
		return target;

	return {
		_tag: "ResolvedModuleTarget",
		moduleId: module.id,
		moduleRoot: module.root,
	};
}

function retargetAdoptedSlotTarget(
	target: EnsuredModuleTarget | ResolvedModuleTarget,
	moduleKey: string,
	module: DiscoveredModule,
): EnsuredModuleTarget | ResolvedModuleTarget {
	if (target._tag !== "EnsuredModuleTarget" || target.moduleKey !== moduleKey)
		return target;

	return {
		_tag: "ResolvedModuleTarget",
		moduleId: module.id,
		moduleRoot: module.root,
	};
}

export function retargetAdoptedContribution(
	contribution: Contribution,
	moduleKey: string,
	module: DiscoveredModule,
	instanceModuleKey: string,
): Contribution {
	switch (contribution._tag) {
		case "EnsureModuleContribution":
			return contribution.moduleKey === moduleKey
				? {
						...contribution,
						moduleKey: instanceModuleKey,
						root: module.root,
					}
				: contribution;

		case "LeafTextFileContribution":
			return {
				...contribution,
				path:
					typeof contribution.path === "string"
						? contribution.path
						: {
								...contribution.path,
								target: retargetAdoptedSlotTarget(
									contribution.path.target,
									moduleKey,
									module,
								),
							},
				target: retargetAdoptedTarget(contribution.target, moduleKey, module),
			};

		case "ManagedDependenciesSurfaceContribution":
		case "ManagedJsonSurfaceContribution":
		case "ManagedLinesSurfaceContribution":
		case "ManagedScriptsSurfaceContribution":
		case "ManagedTextSurfaceContribution":
			return {
				...contribution,
				target: retargetAdoptedTarget(contribution.target, moduleKey, module),
			};

		case "ModuleCapabilitiesContribution":
			return {
				...contribution,
				target: retargetAdoptedModuleTarget(
					contribution.target,
					moduleKey,
					module,
				),
			};
	}
}

function expandAdoptedTemplateEvaluations<ConfigValue>(
	evaluated: EvaluationPhaseContract["evaluated"],
	registry: DefinitionRegistry<ConfigValue>,
	modules: ReadonlyArray<DiscoveredModule>,
): EvaluationPhaseContract["evaluated"] {
	if (modules.length === 0) return evaluated;

	const templateIds = new Set(
		registry.templates.map((template) => template.id),
	);

	return evaluated.flatMap((entry) => {
		if (!templateIds.has(entry.definitionId)) return [entry];

		const ensured = entry.contributions.find(
			(contribution) => contribution._tag === "EnsureModuleContribution",
		);

		if (ensured?.module.type !== "app") return [entry];

		const matchingModules = modules.filter(
			(module) =>
				module.type === "app" &&
				module.template.id === entry.definitionId &&
				module.template.version === ensured.module.template.version,
		);

		if (matchingModules.length === 0) return [entry];

		return matchingModules.map((module, index) => ({
			...entry,
			contributions: entry.contributions.map((contribution) =>
				retargetAdoptedContribution(
					contribution,
					ensured.moduleKey,
					module,
					index === 0 ? ensured.moduleKey : `${ensured.moduleKey}:${module.id}`,
				),
			),
		}));
	});
}

function withModuleId(
	config: EnsureModuleContribution["module"],
	id: ModuleId,
): Config {
	if (config.type === "app") return { ...config, id };
	return { ...config, id };
}

interface PlanIntentCreate<ConfigValue> {
	readonly _tag: "Create";
	readonly commandVersions: Readonly<Record<string, string>>;
	readonly config: ConfigValue;
}

interface PlanIntentInstalled<ConfigValue> {
	readonly _tag: "Installed";
	readonly commandVersions: Readonly<Record<string, string>>;
	readonly config: ConfigValue;
	readonly installs: ReadonlyArray<InstallRecord>;
	readonly registryDescriptors?: ReadonlyArray<RegistryDescriptor>;
	readonly registries?: ReadonlyArray<string>;
}

type PlanIntent<ConfigValue> =
	| PlanIntentCreate<ConfigValue>
	| PlanIntentInstalled<ConfigValue>;

export interface PlannedFile {
	readonly artifactId: string;
	readonly content: string;
	readonly definitionIds: ReadonlyArray<string>;
	readonly kind: "file" | "surface";
	readonly path: string;
	readonly target: RenderBucket;
	readonly targetKey: string;
}

export interface ProjectPlan {
	readonly dependencyNames: Readonly<Record<string, ReadonlyArray<string>>>;
	readonly lockfile: Lockfile;
	readonly manifest: Manifest;
	readonly removals: ReadonlyArray<string>;
	readonly writes: ReadonlyArray<PlannedFile>;
}

interface RenderPlanningPhaseResult {
	readonly dependencyNames: ProjectPlan["dependencyNames"];
	readonly leafFiles: TargetingPhaseContract["result"]["leafFiles"];
	readonly lockfile: Lockfile;
	readonly manifest: Manifest;
	readonly renderedSurfaces: ReadonlyArray<RenderedArtifact>;
	readonly writes: ReadonlyArray<PlannedFile>;
}

interface RenderPlanningPhaseContract {
	// Error union is raise-site-derived, not compiler-bound.
	readonly error: RenderPlanningPhaseError;
	readonly plannerReasons: PlannerReasons<
		"content-hash-failed" | "write-path-collision"
	>;
	readonly result: RenderPlanningPhaseResult;
}

type RenderPlanningPhaseError = PlannerError | RendererError;

function collectDependencyNames<ConfigValue>(
	inputs: ReadonlyArray<SurfaceRenderContribution>,
	definitions: ReadonlyArray<Definition<ConfigValue>>,
): ProjectPlan["dependencyNames"] {
	const directNames = new Map<string, Set<string>>();

	for (const input of inputs) {
		if (input.contribution._tag !== "ManagedDependenciesSurfaceContribution")
			continue;

		const names = directNames.get(input.definitionId) ?? new Set<string>();
		for (const dependency of input.contribution.dependencies)
			names.add(dependency.name);

		directNames.set(input.definitionId, names);
	}

	const definitionsById = new Map(
		definitions.map((definition) => [definition.id, definition]),
	);

	const collectedNames = new Map<string, ReadonlySet<string>>();
	const collect = (definitionId: string): ReadonlySet<string> => {
		const existing = collectedNames.get(definitionId);
		if (existing !== undefined) return existing;

		const names = new Set(directNames.get(definitionId));
		const definition = definitionsById.get(definitionId);
		if (definition !== undefined)
			for (const dependency of definition.dependencies) {
				const dependencyDefinition = definitionsById.get(dependency.id);
				if (dependencyDefinition === undefined) continue;

				for (const name of collect(dependencyDefinition.id)) names.add(name);
			}

		collectedNames.set(definitionId, names);
		return names;
	};

	const entries: Array<readonly [string, ReadonlyArray<string>]> =
		definitions.map((definition) => [
			definition.id,
			[...collect(definition.id)].sort(),
		]);

	return Object.fromEntries(
		entries.sort(([left], [right]) =>
			left < right ? -1 : left > right ? 1 : 0,
		),
	);
}

export interface InstalledPlanningSeed {
	readonly modules: ReadonlyArray<DiscoveredModule>;
	readonly records: Manifest["modules"];
}

function templateMatchesId(templateId: string, moduleTemplateId: string) {
	return templateId === moduleTemplateId;
}

function sameModuleIdentity(
	config: Config,
	ensured: EnsureModuleContribution["module"],
) {
	if (
		config.template.id !== ensured.template.id ||
		config.template.version !== ensured.template.version
	)
		return false;

	if (config.type === "app" && ensured.type === "app")
		return config.framework === ensured.framework;

	if (config.type === "package" && ensured.type === "package")
		return config.packageType === ensured.packageType;

	return false;
}

function findAdoptableModule(
	modules: Iterable<ManagedModuleRecord>,
	ensuredIds: ReadonlySet<ModuleId>,
	staticRoots: ReadonlySet<string>,
	contribution: EnsureModuleContribution,
	definitionId: string,
) {
	const candidates = [...modules].filter(
		(module) =>
			!ensuredIds.has(module.id) &&
			!staticRoots.has(module.root) &&
			module.definitionIds.includes(definitionId) &&
			sameModuleIdentity(module.config, contribution.module),
	);

	return candidates.length === 1 ? candidates[0] : undefined;
}

function rebaseSlots(ensured: Slots, onDisk: Slots): Slots {
	return Object.fromEntries(
		Object.entries(ensured).map(([slot, path]) => [slot, onDisk[slot] ?? path]),
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
	alreadyEnsured: boolean,
	onDiskSlots: Slots,
): Effect.Effect<ManagedModuleRecord, PlannerError> {
	const nextConfig = ensured.module;

	if (!existing)
		return Effect.succeed({
			config: withModuleId(nextConfig, moduleId),
			definitionIds: [definitionId],
			id: moduleId,
			root: ensured.root,
		});

	if (existing.config.type !== nextConfig.type)
		return Effect.fail(
			new PlannerError({
				path: ensured.root,
				reason: "ensured-module-type-conflict",
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
					reason: "ensured-app-module-conflict",
				}),
			);

		return Effect.succeed({
			config: {
				...nextConfig,
				id: existing.id,
				slots: alreadyEnsured
					? {
							...rebaseSlots(nextConfig.slots, onDiskSlots),
							...existing.config.slots,
						}
					: rebaseSlots(nextConfig.slots, onDiskSlots),
				type: "app",
			},
			definitionIds: alreadyEnsured
				? [...new Set([...existing.definitionIds, definitionId])]
				: [definitionId],
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
					reason: "ensured-package-module-conflict",
				}),
			);

		return Effect.succeed({
			config: {
				...nextConfig,
				capabilities: alreadyEnsured
					? [
							...new Set([
								...(nextConfig.capabilities ?? []),
								...(existing.config.capabilities ?? []),
							]),
						]
					: [...(nextConfig.capabilities ?? [])],
				id: existing.id,
				slots: alreadyEnsured
					? {
							...rebaseSlots(nextConfig.slots, onDiskSlots),
							...existing.config.slots,
						}
					: rebaseSlots(nextConfig.slots, onDiskSlots),
				type: "package",
			},
			definitionIds: alreadyEnsured
				? [...new Set([...existing.definitionIds, definitionId])]
				: [definitionId],
			id: existing.id,
			root: existing.root,
		});
	}

	return Effect.fail(
		new PlannerError({
			path: ensured.root,
			reason: "ensured-module-conflict",
		}),
	);
}

function isSlotPath(path: string | SlotPath): path is SlotPath {
	return typeof path !== "string";
}

function isProjectTarget(target: InstallTarget) {
	return target.kind === "project";
}

function installTargetKey(target: InstallTarget) {
	return isProjectTarget(target) ? "project" : `module:${target.moduleId}`;
}

function buildTargetCandidates<ConfigValue>(
	addon: AddonDefinition<ConfigValue>,
	modules: ReadonlyArray<ManagedModuleRecord>,
	frameworks: DefinitionRegistry<ConfigValue>["frameworks"],
	adapters: ReadonlyArray<AdapterDefinition<ConfigValue>>,
): ReadonlyArray<InstallTarget> {
	const hasAdapters = adapters.some((adapter) => adapter.addon === addon.id);
	if (!addon.compatibility && !hasAdapters) return [{ kind: "project" }];

	const compatibleModules = modules
		.filter((module) =>
			isAddonCompatibleWithModule(addon, module.config, frameworks, adapters),
		)
		.map(
			(module): InstallTarget => ({
				kind: "module",
				moduleId: module.id,
			}),
		);

	if (addon.targetMode === "single")
		return compatibleModules[0] ? [compatibleModules[0]] : [];

	return compatibleModules;
}

export function mergeInstallRecords(installs: ReadonlyArray<InstallRecord>) {
	const records = new Map<
		string,
		{
			targets: InstallTarget[];
			versions: NonNullable<InstallRecord["versions"]>[number][];
		}
	>();

	for (const install of installs) {
		const existing = records.get(install.definitionId) ?? {
			targets: [],
			versions: [],
		};

		const targets = [...existing.targets];

		for (const target of install.targets) {
			const key = installTargetKey(target);
			if (targets.some((entry) => installTargetKey(entry) === key)) continue;
			targets.push(target);
		}

		const versions = [...existing.versions];
		for (const version of install.versions ?? []) {
			const exists = versions.some(
				(entry) =>
					entry.root === version.root &&
					entry.section === version.section &&
					entry.name === version.name,
			);

			if (!exists) versions.push(version);
		}

		records.set(install.definitionId, { targets, versions });
	}

	return [...records.entries()].map(([definitionId, record]) => ({
		definitionId,
		targets: record.targets,
		...(record.versions.length === 0 ? {} : { versions: record.versions }),
	}));
}

const makePlanner = Effect.gen(function* () {
	const commandProbe = yield* CommandProbe;
	const configStore = yield* ConfigStore;
	const renderer = yield* Renderer;
	const state = yield* State;

	const resolveCreateSelection = <ConfigValue>(
		config: ConfigValue,
		registry: DefinitionRegistry<ConfigValue>,
	): Effect.Effect<
		SelectionPhaseContract<ConfigValue>["selection"],
		PlannerError
	> => {
		const templates = registry.templates.filter((entry) => entry.when(config));
		const templatesByCategory = new Map<
			string,
			TemplateDefinition<ConfigValue>[]
		>();

		for (const template of templates) {
			const category = templatesByCategory.get(template.category) ?? [];
			category.push(template);
			templatesByCategory.set(template.category, category);
		}

		for (const [category, matchingTemplates] of templatesByCategory)
			if (matchingTemplates.length > 1)
				return Effect.fail(
					new PlannerError({
						path: "registry",
						reason: "multiple-templates-selected",
						category,
					}),
				);

		const directAddons = registry.addons.filter((entry) => entry.when(config));

		return Effect.succeed({
			directAddons,
			templates,
		});
	};

	const validateAddonAgainstTemplates = <ConfigValue>(
		addon: AddonDefinition<ConfigValue>,
		templates: ReadonlyArray<TemplateDefinition<ConfigValue>>,
		registry: DefinitionRegistry<ConfigValue>,
	): Effect.Effect<void, GeneratorError> =>
		Effect.gen(function* () {
			let firstFailure: GeneratorError | undefined;

			for (const template of templates) {
				const framework = registry.frameworks.find(
					(entry) => entry.id === template.framework,
				);

				const result = yield* Effect.result(
					validateAddonAgainstSelection(
						addon,
						framework,
						template,
						registry.adapters,
					),
				);

				if (Result.isSuccess(result)) return;
				firstFailure ??= result.failure;
			}

			if (firstFailure) return yield* firstFailure;
			return yield* validateAddonAgainstSelection(
				addon,
				undefined,
				undefined,
				registry.adapters,
			);
		});

	const resolveDependencies = <ConfigValue>(
		config: ConfigValue,
		registry: DefinitionRegistry<ConfigValue>,
		templates: ReadonlyArray<TemplateDefinition<ConfigValue>>,
		addons: ReadonlyArray<AddonDefinition<ConfigValue>>,
	): Effect.Effect<
		SelectionPhaseContract<ConfigValue>["definitions"],
		PlannerError
	> =>
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

					const dependencyDefinitions: Definition<ConfigValue>[] = [];
					for (const dependency of definition.dependencies) {
						const dependencyDefinition =
							dependency.type === "template"
								? templateById.get(dependency.id)
								: addonById.get(dependency.id);

						if (!dependencyDefinition)
							return yield* new PlannerError({
								path: definition.id,
								reason: "definition-dependency-missing",
							});

						dependencyDefinitions.push(dependencyDefinition);
					}

					for (const dependencyDefinition of dependencyDefinitions) {
						if (dependencyDefinition.when(config)) {
							yield* visit(dependencyDefinition);
							continue;
						}

						const hasActiveAlternative = dependencyDefinitions.some(
							(alternative) =>
								alternative !== dependencyDefinition &&
								alternative._tag === dependencyDefinition._tag &&
								alternative.category === dependencyDefinition.category &&
								alternative.when(config),
						);

						if (!hasActiveAlternative)
							return yield* new PlannerError({
								path: definition.id,
								reason: "definition-dependency-inactive",
							});
					}
				});

			for (const template of templates) yield* visit(template);
			for (const addon of addons) yield* visit(addon);

			return [...resolved.values()];
		});

	const mergeEnsures = Effect.fn("Planner.mergeEnsures")(function* (
		initialModules: ReadonlyArray<ManagedModuleRecord>,
		evaluated: EvaluationPhaseContract["evaluated"],
		initialModuleIdsByKey: ReadonlyMap<string, ModuleId>,
		initialEnsuredIds: ReadonlySet<ModuleId>,
		onDiskSlots: ReadonlyMap<ModuleId, Slots>,
	) {
		const byRoot = new Map(
			initialModules.map((module) => [module.root, module]),
		);

		const byId = new Map(initialModules.map((module) => [module.id, module]));
		const byKey = new Map(initialModuleIdsByKey);

		const usedIds = new Set(initialModules.map((module) => module.id));
		const ensuredIds = new Set(initialEnsuredIds);

		const staticRoots = new Set(
			evaluated.flatMap((entry) =>
				entry.contributions.flatMap((contribution) =>
					contribution._tag === "EnsureModuleContribution"
						? [contribution.root]
						: [],
				),
			),
		);

		for (const entry of evaluated)
			for (const contribution of entry.contributions)
				if (contribution._tag === "EnsureModuleContribution") {
					const direct = byRoot.get(contribution.root);
					const keyedId = byKey.get(contribution.moduleKey);
					const keyed = keyedId ? byId.get(keyedId) : undefined;

					if (direct && keyed && direct.id !== keyed.id)
						return yield* new PlannerError({
							path: contribution.root,
							reason: "module-key-conflict",
							detail: `Module Key Conflict: ${contribution.moduleKey} is claimed by ${direct.root} and ${keyed.root}`,
						});

					const existing =
						direct ??
						keyed ??
						findAdoptableModule(
							byRoot.values(),
							ensuredIds,
							staticRoots,
							contribution,
							entry.definitionId,
						);
					const moduleId = existing
						? existing.id
						: yield* configStore.generateId(usedIds);

					usedIds.add(moduleId);
					const merged = yield* mergeEnsuredModule(
						existing,
						contribution,
						moduleId,
						entry.definitionId,
						ensuredIds.has(moduleId),
						onDiskSlots.get(moduleId) ?? {},
					);

					if (existing && !direct) byRoot.delete(existing.root);

					byRoot.set(contribution.root, merged);
					byId.set(merged.id, merged);
					byKey.set(contribution.moduleKey, merged.id);
					ensuredIds.add(merged.id);
				}

		return {
			ensuredIds,
			moduleIdsByKey: byKey,
			modules: [...byRoot.values()],
			onDiskSlots,
		} satisfies TargetingPhaseContract["result"]["moduleState"];
	});

	const collectModules = Effect.fn("Planner.collectModules")(function* (
		discovered: ReadonlyArray<DiscoveredModule>,
		existingModules: Manifest["modules"],
		evaluated: EvaluationPhaseContract["evaluated"],
	) {
		const activeDefinitionIds = new Set(
			evaluated.map((entry) => entry.definitionId),
		);

		const initialModules = discovered.flatMap((module) => {
			const existing = existingModules[module.id];
			const definitionIds = existing?.definitionIds ?? [];
			const keepDiscovered =
				definitionIds.length === 0 ||
				definitionIds.some((definitionId) =>
					activeDefinitionIds.has(definitionId),
				);

			return keepDiscovered ? [cloneModule(module, existing)] : [];
		});

		const onDiskSlots = new Map<ModuleId, Slots>(
			discovered.map((module) => [module.id, module.slots]),
		);

		return yield* mergeEnsures(
			initialModules,
			evaluated,
			new Map(),
			new Set(),
			onDiskSlots,
		);
	});

	const applyAdapterEnsures = Effect.fn("Planner.applyAdapterEnsures")(
		function* (
			evaluated: EvaluationPhaseContract["evaluated"],
			modules: ReadonlyArray<ManagedModuleRecord>,
			moduleIdsByKey: ReadonlyMap<string, ModuleId>,
			ensuredIds: ReadonlySet<ModuleId>,
			onDiskSlots: ReadonlyMap<ModuleId, Slots>,
		) {
			return yield* mergeEnsures(
				modules,
				evaluated,
				moduleIdsByKey,
				ensuredIds,
				onDiskSlots,
			);
		},
	);

	const resolveModuleTargets = (
		target: TargetRef,
		evaluation: EvaluatedDefinition,
		moduleIdsByKey: ReadonlyMap<string, ModuleId>,
		modules: ReadonlyArray<ManagedModuleRecord>,
		selectedTargets: TargetingPhaseContract["result"]["selectedTargets"],
	): Effect.Effect<ReadonlyArray<RenderBucket>, PlannerError> => {
		switch (target._tag) {
			case "ProjectTarget":
				return Effect.succeed([{ kind: "project" }]);

			case "SelectedModuleTarget": {
				const installTargets =
					selectedTargets.get(evaluation.definitionId) ?? [];

				const selectedModuleTargets = installTargets.filter(
					(entry) => entry.kind === "module",
				);

				if (selectedModuleTargets.length === 0)
					return Effect.fail(
						new PlannerError({
							path: evaluation.definitionId,
							reason: "selected-target-missing",
						}),
					);

				const moduleTargets = selectedModuleTargets.flatMap(
					(entry): ReadonlyArray<RenderBucket> =>
						!evaluation.excludedModuleIds?.has(entry.moduleId)
							? [{ kind: "module", moduleId: entry.moduleId }]
							: [],
				);

				return Effect.succeed(moduleTargets);
			}

			case "EnsuredModuleTarget": {
				const moduleId = moduleIdsByKey.get(target.moduleKey);
				if (!moduleId)
					return Effect.fail(
						new PlannerError({
							path: evaluation.definitionId,
							reason: "ensured-module-missing",
						}),
					);

				return Effect.succeed([{ kind: "module", moduleId }]);
			}

			case "ResolvedModuleTarget":
				return Effect.succeed([{ kind: "module", moduleId: target.moduleId }]);

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
						(module): InstallTarget => ({
							kind: "module",
							moduleId: module.id,
						}),
					);

				if (matches.length === 0)
					return Effect.fail(
						new PlannerError({
							path: evaluation.definitionId,
							reason: "target-module-missing",
						}),
					);

				return Effect.succeed(matches);
			}
		}
	};

	const applyModuleCapabilities = Effect.fn("Planner.applyModuleCapabilities")(
		function* (
			evaluated: EvaluationPhaseContract["evaluated"],
			modules: ReadonlyArray<ManagedModuleRecord>,
			moduleIdsByKey: ReadonlyMap<string, ModuleId>,
			selectedTargets: TargetingPhaseContract["result"]["selectedTargets"],
		) {
			const byId = new Map(modules.map((module) => [module.id, module]));

			for (const entry of evaluated)
				for (const contribution of entry.contributions)
					if (contribution._tag === "ModuleCapabilitiesContribution") {
						const targets = yield* resolveModuleTargets(
							contribution.target,
							entry,
							moduleIdsByKey,
							modules,
							selectedTargets,
						);

						for (const target of targets) {
							if (target.kind !== "module") continue;

							const module = byId.get(target.moduleId);
							if (module?.config.type !== "package") continue;

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
		},
	);

	const collectManagedSurfaceInputs = Effect.fn(
		"Planner.collectManagedSurfaceInputs",
	)(function* (
		evaluated: EvaluationPhaseContract["evaluated"],
		modules: ReadonlyArray<ManagedModuleRecord>,
		moduleIdsByKey: ReadonlyMap<string, ModuleId>,
		selectedTargets: TargetingPhaseContract["result"]["selectedTargets"],
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
					entry,
					moduleIdsByKey,
					modules,
					selectedTargets,
				);

				for (const bucket of targets)
					collected.push({
						bucket,
						contribution,
						definitionId: entry.definitionId,
						order: entry.order,
					});
			}

		return collected;
	});

	const collectLeafFiles = Effect.fn("Planner.collectLeafFiles")(function* (
		evaluated: EvaluationPhaseContract["evaluated"],
		modules: ReadonlyArray<ManagedModuleRecord>,
		moduleIdsByKey: ReadonlyMap<string, ModuleId>,
		selectedTargets: TargetingPhaseContract["result"]["selectedTargets"],
	) {
		const byId = new Map(modules.map((module) => [module.id, module]));
		const leafFiles = new Map<
			string,
			{
				readonly bucket: RenderBucket;
				readonly content: string;
				readonly definitionIds: ReadonlyArray<string>;
			}
		>();

		for (const entry of evaluated)
			for (const contribution of entry.contributions) {
				if (contribution._tag !== "LeafTextFileContribution") continue;

				const targets = yield* resolveModuleTargets(
					contribution.target,
					entry,
					moduleIdsByKey,
					modules,
					selectedTargets,
				);

				for (const target of targets) {
					const leafPath = contribution.path;
					const contributionPath = isSlotPath(leafPath)
						? yield* Effect.gen(function* () {
								if (target.kind !== "module")
									return yield* new PlannerError({
										path: entry.definitionId,
										reason: "slot-path-requires-module-target",
									});

								const module = byId.get(target.moduleId);
								if (!module)
									return yield* new PlannerError({
										path: entry.definitionId,
										reason: "slot-path-module-missing",
									});

								const expectedModuleId =
									leafPath.target._tag === "EnsuredModuleTarget"
										? moduleIdsByKey.get(leafPath.target.moduleKey)
										: leafPath.target.moduleId;

								if (expectedModuleId !== target.moduleId)
									return yield* new PlannerError({
										path: entry.definitionId,
										reason: "slot-path-target-mismatch",
									});

								return yield* resolveSlotPath(module.config, leafPath).pipe(
									Effect.mapError(
										(error) =>
											new PlannerError({
												path: entry.definitionId,
												reason: "slot-path-invalid",
												detail: error.message,
												cause: error,
											}),
									),
								);
							})
						: leafPath;

					const relativePath =
						target.kind === "project"
							? contributionPath
							: `${byId.get(target.moduleId)?.root ?? ""}/${contributionPath}`;

					const existing = leafFiles.get(relativePath);
					if (existing !== undefined) {
						const sameTarget =
							existing.bucket.kind === "project"
								? target.kind === "project"
								: target.kind === "module" &&
									existing.bucket.moduleId === target.moduleId;

						if (
							sameTarget &&
							existing.content === contribution.content &&
							existing.definitionIds.includes(entry.definitionId)
						)
							continue;

						return yield* new PlannerError({
							path: "leaf-files",
							reason: "leaf-file-conflict",
						});
					}

					leafFiles.set(relativePath, {
						bucket: target,
						content: contribution.content,
						definitionIds: [entry.definitionId],
					});
				}
			}

		return [...leafFiles.entries()].map(
			([path, file]): TargetedLeafFile => ({
				bucket: file.bucket,
				content: file.content,
				generators: file.definitionIds,
				path: filePath(path),
			}),
		);
	});

	const buildManifest = Effect.fn("Planner.buildManifest")(function* (
		config: Record<string, unknown>,
		installs: ReadonlyArray<InstallRecord>,
		modules: ReadonlyArray<ManagedModuleRecord>,
		registries: ReadonlyArray<string> | undefined,
		registryDescriptors: ReadonlyArray<RegistryDescriptor> | undefined,
	) {
		return {
			schemaVersion: 1,
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
			...(registries === undefined || registries.length === 0
				? {}
				: { registries }),
			...(registryDescriptors === undefined || registryDescriptors.length === 0
				? {}
				: { registryDescriptors }),
		} satisfies Manifest;
	});

	const hashString = Effect.fn("Planner.hashString")(function* (
		content: string,
	) {
		return yield* hashContentHex(
			content,
			(cause) =>
				new PlannerError({
					path: "content",
					reason: "content-hash-failed",
					cause,
				}),
		);
	});

	const buildLockfile = Effect.fn("Planner.buildLockfile")(function* (
		managedModules: ReadonlyArray<ManagedModuleRecord>,
		renderedSurfaces: RenderPlanningPhaseContract["result"]["renderedSurfaces"],
		leafFiles: RenderPlanningPhaseContract["result"]["leafFiles"],
	) {
		const artifacts: Record<string, LockfileArtifact> = {};

		for (const artifact of renderedSurfaces) {
			const hash = yield* hashString(artifact.content);
			const mergeKind = artifact.mergeKind;
			const targetKey =
				artifact.bucket.kind === "project"
					? "project"
					: `module:${artifact.bucket.moduleId}`;

			artifacts[`${targetKey}:surface:${artifact.key}`] = {
				...(mergeKind === undefined
					? {}
					: {
							base: {
								hash,
								mergeKind,
								semanticsVersion: SURFACE_MERGE_SEMANTICS_VERSION,
							},
						}),
				definitionIds: [...artifact.definitionIds],
				hash,
				kind: "surface",
				path: artifact.path,
			};
		}

		for (const module of managedModules) {
			const hash = yield* hashString(
				formatJson(module.config, { compact: true }),
			);

			const path = `${module.root}/forge.json`;
			artifacts[`module:${module.id}:file:forge.json`] = {
				definitionIds: [...module.definitionIds],
				hash,
				kind: "file",
				path,
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
			};
		}

		return { schemaVersion: 1, artifacts } satisfies Lockfile;
	});

	const buildWrites = (
		modules: ReadonlyArray<ManagedModuleRecord>,
		renderedSurfaces: RenderPlanningPhaseContract["result"]["renderedSurfaces"],
		leafFiles: RenderPlanningPhaseContract["result"]["leafFiles"],
	) =>
		Effect.gen(function* () {
			const writes: PlannedFile[] = [];

			for (const module of modules)
				writes.push({
					artifactId: `module:${module.id}:file:forge.json`,
					content: formatJson(module.config, { compact: true }),
					definitionIds: [module.config.template.id],
					kind: "file",
					path: `${module.root}/forge.json`,
					target: { kind: "module", moduleId: module.id },
					targetKey: `${module.id}:forge.json`,
				});

			for (const artifact of renderedSurfaces)
				writes.push({
					artifactId:
						artifact.bucket.kind === "project"
							? `project:surface:${artifact.key}`
							: `module:${artifact.bucket.moduleId}:surface:${artifact.key}`,
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
					artifactId:
						file.bucket.kind === "project"
							? `project:file:${String(file.path)}`
							: `module:${file.bucket.moduleId}:file:${String(file.path)}`,
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

			const byPath = new Map<string, PlannedFile>();
			for (const write of writes) {
				const existing = byPath.get(write.path);
				if (existing && existing.artifactId !== write.artifactId)
					return yield* new PlannerError({
						path: write.path,
						reason: "write-path-collision",
						detail: `Write Path Collision: ${existing.artifactId} and ${write.artifactId}`,
					});

				byPath.set(write.path, write);
			}

			return [...byPath.values()];
		});

	const plan = Effect.fn("Planner.plan")(function* <
		ConfigValue extends Record<string, unknown>,
	>(
		projectRoot: string,
		registry: DefinitionRegistry<ConfigValue>,
		intent: PlanIntent<ConfigValue>,
		seed?: InstalledPlanningSeed,
	) {
		const discovered =
			seed === undefined
				? yield* configStore.discover(projectRoot)
				: seed.modules;

		const existingManifest = yield* state.readManifestOrDefault(projectRoot);
		const existingLockfile = yield* state.readLockfile(projectRoot);

		const selection: SelectionPhaseContract<ConfigValue>["selection"] =
			intent._tag === "Create"
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

		if (intent._tag === "Create")
			for (const addon of selection.directAddons)
				yield* validateAddonAgainstTemplates(
					addon,
					selection.templates,
					registry,
				);
		else
			for (const addon of selection.directAddons) {
				const targets = intent.installs
					.filter((install) => install.definitionId === addon.id)
					.flatMap((install) => install.targets);

				for (const target of targets) {
					if (target.kind !== "module") continue;

					const module = discovered.find(
						(entry) => entry.id === target.moduleId,
					);

					if (module?.type !== "app") continue;

					const framework = registry.frameworks.find(
						(entry) => entry.id === module.framework,
					);

					const template = registry.templates.find(
						(entry) =>
							entry.framework === module.framework &&
							templateMatchesId(entry.id, module.template.id) &&
							entry.version === module.template.version,
					);

					const hasAdapters = registry.adapters.some(
						(adapter) => adapter.addon === addon.id,
					);

					if (!template && !hasAdapters) continue;

					yield* validateAddonAgainstSelection(
						addon,
						framework,
						template,
						registry.adapters,
					);
				}
			}

		const definitions: SelectionPhaseContract<ConfigValue>["definitions"] =
			yield* resolveDependencies(
				intent.config,
				registry,
				selection.templates,
				selection.directAddons,
			);

		const baseEvaluated: EvaluationPhaseContract["evaluated"] =
			yield* evaluateDefinitions(
				intent.commandVersions,
				intent.config,
				definitions,
				registry.frameworks,
				commandProbe,
			);

		const evaluated: EvaluationPhaseContract["evaluated"] =
			expandAdoptedTemplateEvaluations(baseEvaluated, registry, discovered);

		const {
			ensuredIds,
			moduleIdsByKey,
			modules: mergedModules,
			onDiskSlots,
		} = yield* collectModules(
			discovered,
			seed?.records ?? existingManifest.modules,
			evaluated,
		);

		const baseInstalls =
			intent._tag === "Create"
				? selection.directAddons.map((addon) => ({
						definitionId: addon.id,
						targets: buildTargetCandidates(
							addon,
							mergedModules,
							registry.frameworks,
							registry.adapters,
						),
					}))
				: intent.installs;

		const evaluatedDefinitionIds = new Set(
			evaluated.map((entry) => entry.definitionId),
		);

		const dependencyAdapterInstalls = registry.addons
			.filter(
				(addon) =>
					evaluatedDefinitionIds.has(addon.id) &&
					registry.adapters.some((adapter) => adapter.addon === addon.id) &&
					!baseInstalls.some((install) => install.definitionId === addon.id),
			)
			.map((addon) => ({
				definitionId: addon.id,
				targets: buildTargetCandidates(
					addon,
					mergedModules,
					registry.frameworks,
					registry.adapters,
				),
			}));
		const defaultCreateInstalls = [
			...baseInstalls,
			...dependencyAdapterInstalls,
		];

		for (const install of defaultCreateInstalls) {
			const addon = registry.addons.find(
				(entry) => entry.id === install.definitionId,
			);

			if (!addon)
				return yield* new PlannerError({
					path: install.definitionId,
					reason: "definition-missing",
				});

			if (addon.targetMode === "single" && install.targets.length > 1)
				return yield* new PlannerError({
					path: install.definitionId,
					reason: "multiple-targets-selected",
				});
		}

		const selectedTargets: TargetingPhaseContract["result"]["selectedTargets"] =
			new Map(
				defaultCreateInstalls.map((install) => [
					install.definitionId,
					install.targets,
				]),
			);

		const genericEvaluations = evaluated.flatMap((entry) => {
			const addon = registry.addons.find(
				(candidate) => candidate.id === entry.definitionId,
			);

			if (!addon) return [entry];

			const moduleTargets = (selectedTargets.get(addon.id) ?? []).filter(
				(target) => target.kind === "module",
			);

			const adapterModuleIds = new Set(
				moduleTargets.flatMap((target) => {
					const module = mergedModules.find(
						(candidate) => candidate.id === target.moduleId,
					);

					if (module?.config.type !== "app") return [];

					const moduleConfig = module.config;
					return registry.adapters.some(
						(adapter) =>
							adapter.addon === addon.id &&
							adapter.framework === moduleConfig.framework,
					) && addonDeclaresFramework(addon, moduleConfig.framework)
						? [target.moduleId]
						: [];
				}),
			);

			if (adapterModuleIds.size === 0) return [entry];

			return [{ ...entry, excludedModuleIds: adapterModuleIds }];
		});

		const adapterEvaluations: EvaluationPhaseContract["evaluated"] =
			yield* evaluateAdapters(
				intent.config,
				evaluated,
				registry,
				mergedModules,
				selectedTargets,
				commandProbe,
			);

		const allEvaluated: EvaluationPhaseContract["evaluated"] = [
			...genericEvaluations,
			...adapterEvaluations,
		];
		const { moduleIdsByKey: allModuleIdsByKey, modules: adapterMergedModules } =
			yield* applyAdapterEnsures(
				adapterEvaluations,
				mergedModules,
				moduleIdsByKey,
				ensuredIds,
				onDiskSlots,
			);

		const modules: TargetingPhaseContract["result"]["modules"] =
			yield* applyModuleCapabilities(
				allEvaluated,
				adapterMergedModules,
				allModuleIdsByKey,
				selectedTargets,
			);

		const managedInputs: TargetingPhaseContract["result"]["managedSurfaceInputs"] =
			yield* collectManagedSurfaceInputs(
				allEvaluated,
				modules,
				allModuleIdsByKey,
				selectedTargets,
			);

		const dependencyNames: RenderPlanningPhaseContract["result"]["dependencyNames"] =
			collectDependencyNames(managedInputs, definitions);

		const renderedSurfaces: RenderPlanningPhaseContract["result"]["renderedSurfaces"] =
			yield* renderer.render(
				managedInputs,
				modules.map((module) => ({ ...module.config, root: module.root })),
				dependencyFormatFor(intent.config.packageManager),
				registry.frameworks,
			);

		const leafFiles: RenderPlanningPhaseContract["result"]["leafFiles"] =
			yield* collectLeafFiles(
				allEvaluated,
				modules,
				allModuleIdsByKey,
				selectedTargets,
			);

		const writes: RenderPlanningPhaseContract["result"]["writes"] =
			yield* buildWrites(modules, renderedSurfaces, leafFiles);
		const manifest: RenderPlanningPhaseContract["result"]["manifest"] =
			yield* buildManifest(
				intent.config,
				defaultCreateInstalls.filter((install) => install.targets.length > 0),
				modules,
				intent._tag === "Installed"
					? (intent.registries ?? existingManifest.registries)
					: existingManifest.registries,
				intent._tag === "Installed"
					? (intent.registryDescriptors ?? existingManifest.registryDescriptors)
					: existingManifest.registryDescriptors,
			);

		const lockfile: RenderPlanningPhaseContract["result"]["lockfile"] =
			yield* buildLockfile(modules, renderedSurfaces, leafFiles);

		const previousPaths = new Set(
			Object.values(existingLockfile.artifacts).map(
				(artifact) => artifact.path,
			),
		);

		const nextPaths = new Set(writes.map((write) => write.path));

		const removals = [...previousPaths].filter((path) => !nextPaths.has(path));

		return {
			dependencyNames,
			lockfile,
			manifest,
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
		commandVersions: Readonly<Record<string, string>>,
		seed?: InstalledPlanningSeed,
	) {
		return yield* plan(
			projectRoot,
			registry,
			{
				_tag: "Create",
				commandVersions,
				config,
			},
			seed,
		);
	});

	const planInstalled = Effect.fn("Planner.planInstalled")(function* <
		ConfigValue extends Record<string, unknown>,
	>(
		projectRoot: string,
		config: ConfigValue,
		installs: ReadonlyArray<InstallRecord>,
		registry: DefinitionRegistry<ConfigValue>,
		commandVersions: Readonly<Record<string, string>>,
		registryDescriptors?: ReadonlyArray<RegistryDescriptor>,
		registries?: ReadonlyArray<string>,
		seed?: InstalledPlanningSeed,
	) {
		return yield* plan(
			projectRoot,
			registry,
			{
				_tag: "Installed",
				commandVersions,
				config,
				installs,
				registryDescriptors,
				registries,
			},
			seed,
		);
	});

	return { planCreate, planInstalled };
});

type PlannerService = Effect.Success<typeof makePlanner>;

export class Planner extends Context.Service<Planner, PlannerService>()(
	"Planner",
) {
	static readonly Default = Layer.effect(Planner, makePlanner);
}
