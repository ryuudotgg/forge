import { type Context, Effect } from "effect";
import type {
	AdapterModule,
	AddonDefinition,
	Contribution,
	DefinitionRegistry,
	TemplateDefinition,
} from "./authoring";
import {
	addonDeclaresFramework,
	validateAdapterAgainstModule,
} from "./authoring";
import { CommandProbe } from "./command";
import type { Config, ModuleId, Slots } from "./config";
import {
	GeneratorError,
	type ModuleIdGenerationError,
	PlannerError,
} from "./errors";
import type { filePath } from "./operations";
import type { RenderBucket, SurfaceRenderContribution } from "./renderer";
import type { InstallTarget } from "./state";

export type Definition<ConfigValue> =
	| TemplateDefinition<ConfigValue>
	| AddonDefinition<ConfigValue>;

export type PlannerReasons<Reason extends PlannerError["reason"]> =
	ReadonlyArray<Reason>;

interface SelectionPhaseResult<ConfigValue> {
	readonly directAddons: ReadonlyArray<AddonDefinition<ConfigValue>>;
	readonly templates: ReadonlyArray<TemplateDefinition<ConfigValue>>;
}

export interface SelectionPhaseContract<ConfigValue> {
	readonly definitions: ReadonlyArray<Definition<ConfigValue>>;
	readonly error: SelectionPhaseError;
	readonly plannerReasons: PlannerReasons<
		| "multiple-templates-selected"
		| "definition-dependency-missing"
		| "definition-dependency-inactive"
	>;
	readonly selection: SelectionPhaseResult<ConfigValue>;
}

export type SelectionPhaseError = PlannerError;

export interface EvaluatedDefinition {
	readonly contributions: ReadonlyArray<Contribution>;
	readonly definitionId: string;
	readonly excludedModuleIds?: ReadonlySet<ModuleId>;
	readonly order: number;
}

export interface EvaluationPhaseContract {
	readonly error: EvaluationPhaseError;
	readonly evaluated: ReadonlyArray<EvaluatedDefinition>;
	readonly plannerReasons: PlannerReasons<
		| "definition-cycle-detected"
		| "adapter-target-must-be-module"
		| "adapter-target-app-missing"
		| "adapter-framework-missing"
	>;
}

export type EvaluationPhaseError = PlannerError | GeneratorError;

export interface ManagedModuleRecord {
	config: Config;
	readonly definitionIds: ReadonlyArray<string>;
	readonly id: ModuleId;
	readonly root: string;
}

interface ModuleTargetingState {
	readonly ensuredIds: ReadonlySet<ModuleId>;
	readonly moduleIdsByKey: ReadonlyMap<string, ModuleId>;
	readonly modules: ReadonlyArray<ManagedModuleRecord>;
	readonly onDiskSlots: ReadonlyMap<ModuleId, Slots>;
}

type SelectedTargets = ReadonlyMap<string, ReadonlyArray<InstallTarget>>;

export interface TargetedLeafFile {
	readonly bucket: RenderBucket;
	readonly content: string;
	readonly generators: ReadonlyArray<string>;
	readonly path: ReturnType<typeof filePath>;
}

interface TargetingPhaseResult {
	readonly leafFiles: ReadonlyArray<TargetedLeafFile>;
	readonly managedSurfaceInputs: ReadonlyArray<SurfaceRenderContribution>;
	readonly moduleState: ModuleTargetingState;
	readonly modules: ReadonlyArray<ManagedModuleRecord>;
	readonly selectedTargets: SelectedTargets;
}

export interface TargetingPhaseContract {
	// Error union is raise-site-derived, not compiler-bound.
	readonly error: TargetingPhaseError;
	readonly plannerReasons: PlannerReasons<
		| "ensured-module-type-conflict"
		| "ensured-app-module-conflict"
		| "ensured-package-module-conflict"
		| "ensured-module-conflict"
		| "module-key-conflict"
		| "selected-target-missing"
		| "ensured-module-missing"
		| "target-module-missing"
		| "slot-path-requires-module-target"
		| "slot-path-module-missing"
		| "slot-path-target-mismatch"
		| "slot-path-invalid"
		| "leaf-file-conflict"
		| "definition-missing"
		| "multiple-targets-selected"
	>;
	readonly result: TargetingPhaseResult;
}

export type TargetingPhaseError = PlannerError | ModuleIdGenerationError;

export function definitionKey<ConfigValue>(
	definition: Definition<ConfigValue>,
) {
	return `${definition._tag}:${definition.id}`;
}

function normalizeContributionResult(
	generatorId: string,
	contribute: () =>
		| ReadonlyArray<Contribution>
		| Promise<ReadonlyArray<Contribution>>
		| Effect.Effect<ReadonlyArray<Contribution>, GeneratorError, CommandProbe>,
): Effect.Effect<ReadonlyArray<Contribution>, GeneratorError, CommandProbe> {
	return Effect.suspend(() => {
		let result: ReturnType<typeof contribute>;
		try {
			result = contribute();
		} catch (error) {
			return Effect.fail(
				new GeneratorError({
					generatorId,
					reason: "definition-failed",
					detail: error instanceof Error ? error.message : String(error),
					cause: error,
				}),
			);
		}

		if (Effect.isEffect(result)) return result;
		if (result instanceof Promise) {
			return Effect.tryPromise({
				try: () => result,
				catch: (cause) =>
					new GeneratorError({
						generatorId,
						reason: "definition-failed",
						detail: cause instanceof Error ? cause.message : String(cause),
						cause,
					}),
			});
		}

		return Effect.succeed(result);
	});
}

const orderDefinitions = <ConfigValue>(
	definitions: SelectionPhaseContract<ConfigValue>["definitions"],
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
					reason: "definition-cycle-detected",
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

export const evaluateDefinitions = Effect.fn("Planner.evaluateDefinitions")(
	function* <ConfigValue extends Record<string, unknown>>(
		commandVersions: Readonly<Record<string, string>>,
		config: ConfigValue,
		definitions: SelectionPhaseContract<ConfigValue>["definitions"],
		frameworks: DefinitionRegistry<ConfigValue>["frameworks"],
		commandProbe: Context.Service.Shape<typeof CommandProbe>,
	) {
		const ordered = yield* orderDefinitions(definitions);

		return yield* Effect.forEach(ordered, (definition, order) =>
			normalizeContributionResult(definition.id, () =>
				definition.contribute({
					commandVersions,
					config,
					frameworks,
				}),
			).pipe(
				Effect.provideService(CommandProbe, commandProbe),
				Effect.map(
					(contributions) =>
						({
							contributions,
							definitionId: definition.id,
							order,
						}) satisfies EvaluatedDefinition,
				),
			),
		);
	},
);

export const evaluateAdapters = Effect.fn("Planner.evaluateAdapters")(
	function* <ConfigValue extends Record<string, unknown>>(
		config: ConfigValue,
		evaluated: EvaluationPhaseContract["evaluated"],
		registry: DefinitionRegistry<ConfigValue>,
		modules: ReadonlyArray<ManagedModuleRecord>,
		selectedTargets: TargetingPhaseContract["result"]["selectedTargets"],
		commandProbe: Context.Service.Shape<typeof CommandProbe>,
	) {
		const modulesById = new Map(modules.map((module) => [module.id, module]));
		const frameworksById = new Map(
			registry.frameworks.map((framework) => [framework.id, framework]),
		);

		const orderByDefinitionId = new Map(
			evaluated.map((entry) => [entry.definitionId, entry.order]),
		);

		const adapterEvaluations: EvaluatedDefinition[] = [];

		for (const addon of registry.addons) {
			const addonAdapters = registry.adapters.filter(
				(adapter) => adapter.addon === addon.id,
			);

			if (addonAdapters.length === 0) continue;

			const order = orderByDefinitionId.get(addon.id);
			if (order === undefined) continue;

			const targets = selectedTargets.get(addon.id) ?? [];
			for (const target of targets) {
				if (target.kind !== "module")
					return yield* new PlannerError({
						path: addon.id,
						reason: "adapter-target-must-be-module",
					});

				const module = modulesById.get(target.moduleId);
				if (!module)
					return yield* new PlannerError({
						path: addon.id,
						reason: "adapter-target-app-missing",
					});

				if (module.config.type !== "app") continue;

				const framework = frameworksById.get(module.config.framework);
				if (!framework)
					return yield* new PlannerError({
						path: addon.id,
						reason: "adapter-framework-missing",
					});

				const adapter = addonAdapters.find(
					(entry) => entry.framework === framework.id,
				);

				if (!adapter && addonDeclaresFramework(addon, framework.id)) continue;
				if (!adapter)
					return yield* new GeneratorError({
						generatorId: addon.id,
						reason: "framework-not-supported-yet",
						generatorName: addon.name,
						frameworkName: framework.name,
					});

				const adapterModule: AdapterModule = {
					config: module.config,
					id: module.id,
					root: module.root,
				};

				yield* validateAdapterAgainstModule(
					addon,
					adapter,
					adapterModule,
					framework,
				);

				const contributions = yield* normalizeContributionResult(addon.id, () =>
					adapter.contribute({
						config,
						framework,
						module: adapterModule,
						slots: adapterModule.config.slots,
					}),
				).pipe(Effect.provideService(CommandProbe, commandProbe));

				adapterEvaluations.push({
					contributions,
					definitionId: addon.id,
					order,
				});
			}
		}

		return adapterEvaluations;
	},
);
