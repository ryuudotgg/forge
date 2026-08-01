import { Effect, Schema } from "effect";
import packageJson from "../package.json" with { type: "json" };
import type { CommandProbe } from "./command";
import type { AppConfig, ModuleId, PackageConfig, Slots } from "./config";
import { GeneratorError, RegistryError } from "./errors";
import type { Dependency } from "./operations";

const coreMajorVersion = Number.parseInt(
	packageJson.version.split(".")[0] ?? "",
	10,
);

export const authoringApiVersion = Number.isFinite(coreMajorVersion)
	? Math.max(1, coreMajorVersion)
	: 1;

export const packageSlotNames = {
	globalsCss: "globalsCss",
	themeCss: "themeCss",
	utils: "utils",
	postcssConfig: "postcssConfig",
	client: "client",
	provider: "provider",
} as const;

export type PackageSlotName =
	(typeof packageSlotNames)[keyof typeof packageSlotNames];

export type FrameworkId = string;
export type TemplateId = string;
export type AddonId = string;
export type CapabilityId = string;
export type TargetMode = "single" | "multiple";

export type GeneratorCategory =
	| "workspace"
	| "tooling"
	| "linter"
	| "web"
	| "backend"
	| "orm"
	| "database"
	| "auth"
	| "style"
	| "ui"
	| "runtime"
	| "packageManager"
	| "addon";

export const projectSurfaceNames = {
	rootPackageJson: "rootPackageJson",
	rootTsconfig: "rootTsconfig",
	workspaceConfig: "workspaceConfig",
	biomeConfig: "biomeConfig",
	gitignore: "gitignore",
	rootEnv: "rootEnv",
	rootEnvExample: "rootEnvExample",
} as const;

export type ProjectSurfaceName =
	(typeof projectSurfaceNames)[keyof typeof projectSurfaceNames];

export const packageManagedSurfaceNames = {
	packageJson: "packageJson",
	tsconfig: "tsconfig",
} as const;

export type PackageManagedSurfaceName =
	(typeof packageManagedSurfaceNames)[keyof typeof packageManagedSurfaceNames];

export type PackageSurfaceName = PackageSlotName | PackageManagedSurfaceName;

export type ManagedSurfaceName = string;

export interface TemplateRef<Id extends TemplateId = TemplateId> {
	readonly id: Id;
	readonly version: number;
}

export interface ProjectTarget {
	readonly _tag: "ProjectTarget";
}

export interface SelectedModuleTarget {
	readonly _tag: "SelectedModuleTarget";
}

export interface EnsuredModuleTarget {
	readonly _tag: "EnsuredModuleTarget";
	readonly moduleKey: string;
}

export interface ResolvedModuleTarget {
	readonly _tag: "ResolvedModuleTarget";
	readonly moduleId: ModuleId;
	readonly moduleRoot: string;
}

export interface SlotPath {
	readonly _tag: "SlotPath";
	readonly module: string;
	readonly target: EnsuredModuleTarget | ResolvedModuleTarget;
	readonly slot: string;
}

export class SlotPathError extends Schema.TaggedError<SlotPathError>()(
	"SlotPathError",
	{
		message: Schema.String,
		module: Schema.String,
		slot: Schema.String,
	},
) {}

export interface TemplateModuleTarget<Id extends TemplateId = TemplateId> {
	readonly _tag: "TemplateModuleTarget";
	readonly template: TemplateRef<Id>;
}

export type ModuleTarget =
	| SelectedModuleTarget
	| EnsuredModuleTarget
	| ResolvedModuleTarget
	| TemplateModuleTarget;

export type TargetRef = ProjectTarget | ModuleTarget;

export function projectTarget(): ProjectTarget {
	return { _tag: "ProjectTarget" };
}

export function selectedModuleTarget(): SelectedModuleTarget {
	return { _tag: "SelectedModuleTarget" };
}

export function ensuredModuleTarget(moduleKey: string): EnsuredModuleTarget {
	return { _tag: "EnsuredModuleTarget", moduleKey };
}

export function moduleTarget(module: AdapterModule): ResolvedModuleTarget {
	return {
		_tag: "ResolvedModuleTarget",
		moduleId: module.id,
		moduleRoot: module.root,
	};
}

export function slotPath(
	target: EnsuredModuleTarget | ResolvedModuleTarget,
	slot: string,
): SlotPath {
	return {
		_tag: "SlotPath",
		module:
			target._tag === "EnsuredModuleTarget"
				? target.moduleKey
				: target.moduleRoot,
		target,
		slot,
	};
}

export function templateModuleTarget<Id extends TemplateId>(
	id: Id,
	version: number,
): TemplateModuleTarget<Id> {
	return { _tag: "TemplateModuleTarget", template: { id, version } };
}

export interface AppCompatibility<Framework extends FrameworkId = FrameworkId> {
	readonly frameworks?: ReadonlyArray<Framework>;
	readonly templates?: ReadonlyArray<TemplateRef>;
	readonly requiredSlots?: ReadonlyArray<string>;
}

export interface PackageCompatibility<
	Capability extends CapabilityId = CapabilityId,
> {
	readonly capabilities?: ReadonlyArray<Capability>;
	readonly requiredSlots?: ReadonlyArray<PackageSlotName>;
}

export interface Compatibility<
	Framework extends FrameworkId = FrameworkId,
	Capability extends CapabilityId = CapabilityId,
> {
	readonly app?: AppCompatibility<Framework>;
	readonly package?: PackageCompatibility<Capability>;
}

type EnsuredModuleShape = Omit<AppConfig, "id"> | Omit<PackageConfig, "id">;

export interface EnsureModuleContribution {
	readonly _tag: "EnsureModuleContribution";
	readonly moduleKey: string;
	readonly root: string;
	readonly module: EnsuredModuleShape;
}

export interface ManagedTextSurfaceContribution {
	readonly _tag: "ManagedTextSurfaceContribution";
	readonly target: TargetRef;
	readonly surface: ManagedSurfaceName;
	readonly content: string;
	readonly priority?: number;
}

export interface ManagedJsonSurfaceContribution {
	readonly _tag: "ManagedJsonSurfaceContribution";
	readonly target: TargetRef;
	readonly surface: ManagedSurfaceName;
	readonly value: Record<string, unknown>;
	readonly priority?: number;
	readonly strategy?: "deep" | "replace";
}

export interface ManagedLinesSurfaceContribution {
	readonly _tag: "ManagedLinesSurfaceContribution";
	readonly target: TargetRef;
	readonly surface: ManagedSurfaceName;
	readonly lines: ReadonlyArray<string>;
	readonly section?: string;
	readonly position?: "start" | "end";
}

export interface ManagedDependenciesSurfaceContribution {
	readonly _tag: "ManagedDependenciesSurfaceContribution";
	readonly target: TargetRef;
	readonly surface:
		| typeof projectSurfaceNames.rootPackageJson
		| "packageJson"
		| typeof packageManagedSurfaceNames.packageJson;
	readonly dependencies: ReadonlyArray<Dependency>;
}

export interface ManagedScriptsSurfaceContribution {
	readonly _tag: "ManagedScriptsSurfaceContribution";
	readonly target: TargetRef;
	readonly surface:
		| typeof projectSurfaceNames.rootPackageJson
		| "packageJson"
		| typeof packageManagedSurfaceNames.packageJson;
	readonly scripts: Record<string, string>;
}

export interface ModuleCapabilitiesContribution<
	Capability extends CapabilityId = CapabilityId,
> {
	readonly _tag: "ModuleCapabilitiesContribution";
	readonly target: ModuleTarget;
	readonly capabilities: ReadonlyArray<Capability>;
}

export interface LeafTextFileContribution {
	readonly _tag: "LeafTextFileContribution";
	readonly target: TargetRef;
	readonly path: string | SlotPath;
	readonly content: string;
}

export type Contribution<Capability extends CapabilityId = CapabilityId> =
	| EnsureModuleContribution
	| ManagedTextSurfaceContribution
	| ManagedJsonSurfaceContribution
	| ManagedLinesSurfaceContribution
	| ManagedDependenciesSurfaceContribution
	| ManagedScriptsSurfaceContribution
	| ModuleCapabilitiesContribution<Capability>
	| LeafTextFileContribution;

export function ensureAppModule(
	moduleKey: string,
	root: string,
	module: Omit<AppConfig, "id" | "type">,
): EnsureModuleContribution {
	return {
		_tag: "EnsureModuleContribution",
		moduleKey,
		root,
		module: { ...module, type: "app" },
	};
}

export function ensurePackageModule(
	moduleKey: string,
	root: string,
	module: Omit<PackageConfig, "id" | "type">,
): EnsureModuleContribution {
	return {
		_tag: "EnsureModuleContribution",
		moduleKey,
		root,
		module: { ...module, type: "package" },
	};
}

export function surfaceText(
	target: TargetRef,
	surface: ManagedSurfaceName,
	content: string,
	options?: { readonly priority?: number },
): ManagedTextSurfaceContribution {
	return {
		_tag: "ManagedTextSurfaceContribution",
		target,
		surface,
		content,
		priority: options?.priority,
	};
}

export function surfaceJson(
	target: TargetRef,
	surface: ManagedSurfaceName,
	value: Record<string, unknown>,
	options?: {
		readonly priority?: number;
		readonly strategy?: "deep" | "replace";
	},
): ManagedJsonSurfaceContribution {
	return {
		_tag: "ManagedJsonSurfaceContribution",
		target,
		surface,
		value,
		priority: options?.priority,
		strategy: options?.strategy,
	};
}

export function surfaceLines(
	target: TargetRef,
	surface: ManagedSurfaceName,
	items: ReadonlyArray<string>,
	options?: {
		readonly position?: "start" | "end";
		readonly section?: string;
	},
): ManagedLinesSurfaceContribution {
	return {
		_tag: "ManagedLinesSurfaceContribution",
		target,
		surface,
		lines: items,
		position: options?.position,
		section: options?.section,
	};
}

export function surfaceDependencies(
	target: TargetRef,
	surface:
		| typeof projectSurfaceNames.rootPackageJson
		| "packageJson"
		| typeof packageManagedSurfaceNames.packageJson,
	items: ReadonlyArray<Dependency>,
): ManagedDependenciesSurfaceContribution {
	return {
		_tag: "ManagedDependenciesSurfaceContribution",
		target,
		surface,
		dependencies: items,
	};
}

export function surfaceScripts(
	target: TargetRef,
	surface:
		| typeof projectSurfaceNames.rootPackageJson
		| "packageJson"
		| typeof packageManagedSurfaceNames.packageJson,
	items: Record<string, string>,
): ManagedScriptsSurfaceContribution {
	return {
		_tag: "ManagedScriptsSurfaceContribution",
		target,
		surface,
		scripts: items,
	};
}

export function moduleCapabilities<Capability extends CapabilityId>(
	target: ModuleTarget,
	capabilities: ReadonlyArray<Capability>,
): ModuleCapabilitiesContribution<Capability> {
	return {
		_tag: "ModuleCapabilitiesContribution",
		target,
		capabilities,
	};
}

export function leafTextFile(
	target: TargetRef,
	path: string | SlotPath,
	content: string,
): LeafTextFileContribution {
	return { _tag: "LeafTextFileContribution", target, path, content };
}

export function resolveSlotPath(
	module: EnsuredModuleShape,
	path: SlotPath,
): Effect.Effect<string, SlotPathError> {
	const resolved = module.slots[path.slot];
	if (resolved !== undefined) return Effect.succeed(resolved);

	return Effect.fail(
		new SlotPathError({
			message: `Module Slot Missing: ${path.slot} in ${path.module}`,
			module: path.module,
			slot: path.slot,
		}),
	);
}

export interface DefinitionContext<Config> {
	readonly commandVersions: Readonly<Record<string, string>>;
	readonly config: Config;
	readonly frameworks: ReadonlyArray<FrameworkDefinition>;
}

type ContributionResult<Capability extends CapabilityId = CapabilityId> =
	| ReadonlyArray<Contribution<Capability>>
	| Promise<ReadonlyArray<Contribution<Capability>>>
	| Effect.Effect<
			ReadonlyArray<Contribution<Capability>>,
			GeneratorError,
			CommandProbe
	  >;

export interface AdapterModule {
	readonly config: AppConfig;
	readonly id: ModuleId;
	readonly root: string;
}

export interface AdapterContext<Config> {
	readonly config: Config;
	readonly framework: FrameworkDefinition;
	readonly module: AdapterModule;
	readonly slots: Slots;
}

export interface DependencyRef {
	readonly id: AddonId | TemplateId;
	readonly type: "addon" | "template";
}

export interface FrameworkDefinition<
	Id extends FrameworkId = FrameworkId,
	Slot extends string = string,
> {
	readonly _tag: "FrameworkDefinition";
	readonly buildOutputs: ReadonlyArray<string>;
	readonly configFile: string;
	readonly id: Id;
	readonly ignoreDirs: ReadonlyArray<string>;
	readonly name: string;
	readonly slots: ReadonlyArray<Slot>;
	readonly tsconfigPreset: {
		readonly content: Record<string, unknown>;
		readonly name: string;
	};
}

export interface AdapterDefinition<
	Config,
	Addon extends AddonId = AddonId,
	Framework extends FrameworkId = FrameworkId,
> {
	readonly _tag: "AdapterDefinition";
	readonly addon: Addon;
	readonly framework: Framework;
	readonly requiredSlots: ReadonlyArray<string>;
	readonly contribute: (context: AdapterContext<Config>) => ContributionResult;
}

export interface TemplateDefinition<
	Config,
	Id extends TemplateId = TemplateId,
	Framework extends FrameworkId = FrameworkId,
> {
	readonly _tag: "TemplateDefinition";
	readonly id: Id;
	readonly framework: Framework;
	readonly name: string;
	readonly version: number;
	readonly category: GeneratorCategory;
	readonly exclusive: boolean;
	readonly dependencies: ReadonlyArray<DependencyRef>;
	readonly when: (config: Config) => boolean;
	readonly contribute: (
		context: DefinitionContext<Config>,
	) => ContributionResult;
}

export interface AddonDefinition<
	Config,
	Id extends AddonId = AddonId,
	Framework extends FrameworkId = FrameworkId,
	Capability extends CapabilityId = CapabilityId,
> {
	readonly _tag: "AddonDefinition";
	readonly id: Id;
	readonly name: string;
	readonly version: string;
	readonly category: GeneratorCategory;
	readonly exclusive: boolean;
	readonly dependencies: ReadonlyArray<DependencyRef>;
	readonly targetMode: TargetMode;
	readonly compatibility?: Compatibility<Framework, Capability>;
	readonly when: (config: Config) => boolean;
	readonly contribute: (
		context: DefinitionContext<Config>,
	) => ContributionResult<Capability>;
}

export interface DefinitionRegistry<Config> {
	readonly adapters: ReadonlyArray<AdapterDefinition<Config>>;
	readonly frameworks: ReadonlyArray<FrameworkDefinition>;
	readonly templates: ReadonlyArray<TemplateDefinition<Config>>;
	readonly addons: ReadonlyArray<AddonDefinition<Config>>;
}

export function defineFramework<
	const Id extends FrameworkId,
	const Slots extends ReadonlyArray<string>,
>(framework: {
	readonly buildOutputs: ReadonlyArray<string>;
	readonly configFile: string;
	readonly id: Id;
	readonly ignoreDirs: ReadonlyArray<string>;
	readonly name: string;
	readonly slots: Slots;
	readonly tsconfigPreset: {
		readonly content: Record<string, unknown>;
		readonly name: string;
	};
}): FrameworkDefinition<Id, Slots[number]> {
	return { _tag: "FrameworkDefinition", ...framework };
}

export function defineAdapter<
	Config,
	const Addon extends AddonId = AddonId,
	const Framework extends FrameworkId = FrameworkId,
>(adapter: {
	readonly addon: Addon;
	readonly framework: Framework;
	readonly requiredSlots?: ReadonlyArray<string>;
	readonly contribute: (context: AdapterContext<Config>) => ContributionResult;
}): AdapterDefinition<Config, Addon, Framework> {
	return {
		_tag: "AdapterDefinition",
		...adapter,
		requiredSlots: adapter.requiredSlots ?? [],
	};
}

export function defineTemplate<
	Config,
	const Id extends TemplateId = TemplateId,
	const Framework extends FrameworkId = FrameworkId,
>(template: {
	readonly id: Id;
	readonly framework: Framework;
	readonly name: string;
	readonly version: number;
	readonly category: GeneratorCategory;
	readonly exclusive: boolean;
	readonly dependencies?: ReadonlyArray<DependencyRef>;
	readonly when: (config: Config) => boolean;
	readonly contribute: (
		context: DefinitionContext<Config>,
	) => ContributionResult;
}): TemplateDefinition<Config, Id, Framework> {
	return {
		_tag: "TemplateDefinition",
		dependencies: template.dependencies ?? [],
		...template,
	};
}

export function defineAddon<
	Config,
	const Id extends AddonId = AddonId,
	const Framework extends FrameworkId = FrameworkId,
	const Capability extends CapabilityId = CapabilityId,
>(addon: {
	readonly id: Id;
	readonly name: string;
	readonly version: string;
	readonly category: GeneratorCategory;
	readonly exclusive: boolean;
	readonly dependencies?: ReadonlyArray<DependencyRef>;
	readonly targetMode: TargetMode;
	readonly compatibility?: Compatibility<Framework, Capability>;
	readonly when: (config: Config) => boolean;
	readonly contribute: (
		context: DefinitionContext<Config>,
	) => ContributionResult<Capability>;
}): AddonDefinition<Config, Id, Framework, Capability> {
	return {
		_tag: "AddonDefinition",
		dependencies: addon.dependencies ?? [],
		...addon,
	};
}

export function defineRegistry<Config>(registry: {
	readonly adapters?: ReadonlyArray<AdapterDefinition<Config>>;
	readonly frameworks: ReadonlyArray<FrameworkDefinition>;
	readonly templates: ReadonlyArray<TemplateDefinition<Config>>;
	readonly addons: ReadonlyArray<AddonDefinition<Config>>;
}): DefinitionRegistry<Config> {
	const adapters = registry.adapters ?? [];
	const validateUniqueIds = (
		kind: "Addon" | "Framework" | "Template",
		entries: ReadonlyArray<{ readonly id: string }>,
	) => {
		const ids = new Set<string>();
		for (const entry of entries) {
			if (ids.has(entry.id))
				throw new RegistryError({
					message: `${kind} Duplicate: ${entry.id}`,
					registryId: entry.id,
				});

			ids.add(entry.id);
		}
	};

	validateUniqueIds("Addon", registry.addons);
	validateUniqueIds("Framework", registry.frameworks);
	validateUniqueIds("Template", registry.templates);

	for (const framework of registry.frameworks) {
		const uniqueSlots = new Set(framework.slots);
		const hasEmptySlot = framework.slots.some((slot) => slot.length === 0);

		if (
			framework.slots.length === 0 ||
			hasEmptySlot ||
			uniqueSlots.size !== framework.slots.length
		)
			throw new RegistryError({
				message: `Framework Slots Invalid: ${framework.id}`,
				registryId: framework.id,
			});
	}

	const addonIds = new Set(registry.addons.map((addon) => addon.id));
	const frameworkIds = new Set(
		registry.frameworks.map((framework) => framework.id),
	);

	const adapterKeys = new Set<string>();
	for (const adapter of adapters) {
		const key = `${adapter.addon}:${adapter.framework}`;

		if (adapterKeys.has(key))
			throw new RegistryError({
				message: `Adapter Duplicate: ${key}`,
				registryId: key,
			});

		if (!addonIds.has(adapter.addon))
			throw new RegistryError({
				message: `Adapter Addon Missing: ${adapter.addon}`,
				registryId: key,
			});

		if (!frameworkIds.has(adapter.framework))
			throw new RegistryError({
				message: `Adapter Framework Missing: ${adapter.framework}`,
				registryId: key,
			});

		const framework = registry.frameworks.find(
			(entry) => entry.id === adapter.framework,
		);

		const invalidSlot = adapter.requiredSlots.find(
			(slot) => !framework?.slots.includes(slot),
		);

		if (invalidSlot)
			throw new RegistryError({
				message: `Adapter Slot Missing: ${key}:${invalidSlot}`,
				registryId: key,
			});

		adapterKeys.add(key);
	}

	return { ...registry, adapters };
}

function templateMatches<Config>(
	expected: TemplateRef,
	template: TemplateDefinition<Config>,
): boolean {
	return expected.id === template.id && expected.version === template.version;
}

function packageHasRequiredSlots(
	module: PackageConfig,
	requiredSlots: ReadonlyArray<PackageSlotName>,
): boolean {
	return requiredSlots.every((slot) => slot in module.slots);
}

function packageHasCapabilities(
	module: PackageConfig,
	requiredCapabilities: ReadonlyArray<CapabilityId>,
): boolean {
	const capabilities = new Set(module.capabilities ?? []);
	return requiredCapabilities.every((capability) =>
		capabilities.has(capability),
	);
}

export function isAddonCompatibleWithModule<Config>(
	addon: AddonDefinition<Config>,
	module: AppConfig | PackageConfig,
	frameworks: ReadonlyArray<FrameworkDefinition> = [],
	adapters: ReadonlyArray<AdapterDefinition<Config>> = [],
): boolean {
	const addonAdapters = adapters.filter(
		(adapter) => adapter.addon === addon.id,
	);

	if (addonAdapters.length > 0) {
		if (module.type !== "app") return false;

		const adapter = addonAdapters.find(
			(entry) => entry.framework === module.framework,
		);

		return adapter !== undefined;
	}

	const compatibility = addon.compatibility;
	if (!compatibility) return true;

	if (module.type === "app") {
		const appCompatibility = compatibility.app;
		if (!appCompatibility) return false;

		if (
			appCompatibility.frameworks &&
			!appCompatibility.frameworks.includes(module.framework)
		)
			return false;

		if (
			appCompatibility.templates &&
			!appCompatibility.templates.some(
				(template) =>
					template.id === module.template.id &&
					template.version === module.template.version,
			)
		)
			return false;

		if (appCompatibility.requiredSlots) {
			const framework = frameworks.find(
				(definition) => definition.id === module.framework,
			);

			const hasRequiredSlots = framework
				? appCompatibility.requiredSlots.every((slot) =>
						framework.slots.includes(slot),
					)
				: appCompatibility.requiredSlots.every((slot) => slot in module.slots);

			if (!hasRequiredSlots) return false;
		}

		return true;
	}

	const packageCompatibility = compatibility.package;
	if (!packageCompatibility) return false;

	if (
		packageCompatibility.capabilities &&
		!packageHasCapabilities(module, packageCompatibility.capabilities)
	)
		return false;

	if (
		packageCompatibility.requiredSlots &&
		!packageHasRequiredSlots(module, packageCompatibility.requiredSlots)
	)
		return false;

	return true;
}

export function validateAddonAgainstSelection<Config>(
	addon: AddonDefinition<Config>,
	framework: FrameworkDefinition | undefined,
	template: TemplateDefinition<Config> | undefined,
	adapters: ReadonlyArray<AdapterDefinition<Config>> = [],
): Effect.Effect<void, GeneratorError> {
	const addonAdapters = adapters.filter(
		(adapter) => adapter.addon === addon.id,
	);

	if (addonAdapters.length > 0) {
		if (!framework)
			return Effect.fail(
				new GeneratorError({
					generatorId: addon.id,
					message: `${addon.name} requires a web framework template.`,
				}),
			);

		if (!addonAdapters.some((adapter) => adapter.framework === framework.id))
			return Effect.fail(
				new GeneratorError({
					generatorId: addon.id,
					message: `${addon.name} does not support ${framework.name} yet.`,
				}),
			);

		return Effect.void;
	}

	const compatibility = addon.compatibility;
	if (!compatibility?.app) return Effect.void;

	if (!framework || !template)
		return Effect.fail(
			new GeneratorError({
				generatorId: addon.id,
				message: `${addon.name} requires a web framework template.`,
			}),
		);

	if (
		compatibility.app.frameworks &&
		!compatibility.app.frameworks.includes(framework.id)
	)
		return Effect.fail(
			new GeneratorError({
				generatorId: addon.id,
				message: `${addon.name} does not support ${framework.name}.`,
			}),
		);

	if (
		compatibility.app.templates &&
		!compatibility.app.templates.some((expected) =>
			templateMatches(expected, template),
		)
	)
		return Effect.fail(
			new GeneratorError({
				generatorId: addon.id,
				message: `${addon.name} does not support the selected ${framework.name} template.`,
			}),
		);

	if (
		compatibility.app.requiredSlots &&
		!compatibility.app.requiredSlots.every((slot) =>
			framework.slots.includes(slot),
		)
	) {
		const missingSlots = compatibility.app.requiredSlots.filter(
			(slot) => !framework.slots.includes(slot),
		);

		const formattedSlots = new Intl.ListFormat("en", {
			style: "long",
			type: "conjunction",
		}).format(missingSlots.map((slot) => `${slot} slot`));

		return Effect.fail(
			new GeneratorError({
				generatorId: addon.id,
				message: `${addon.name} requires the ${formattedSlots}, but ${framework.name} does not provide ${missingSlots.length === 1 ? "it" : "them"}.`,
			}),
		);
	}

	return Effect.void;
}

export function validateAdapterAgainstModule<Config>(
	addon: AddonDefinition<Config>,
	adapter: AdapterDefinition<Config>,
	module: AdapterModule,
	framework: FrameworkDefinition,
): Effect.Effect<void, GeneratorError> {
	const missingSlots = adapter.requiredSlots.filter(
		(slot) => !(slot in module.config.slots),
	);

	if (missingSlots.length === 0) return Effect.void;

	const formattedSlots = new Intl.ListFormat("en", {
		style: "long",
		type: "conjunction",
	}).format(missingSlots.map((slot) => `${slot} slot`));

	return Effect.fail(
		new GeneratorError({
			generatorId: addon.id,
			message: `${addon.name} requires the ${formattedSlots}, but ${framework.name} does not provide ${missingSlots.length === 1 ? "it" : "them"}.`,
		}),
	);
}
