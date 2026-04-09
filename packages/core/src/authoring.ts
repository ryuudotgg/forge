import { Effect } from "effect";
import type { CommandProbe } from "./command";
import type { AppConfig, PackageConfig } from "./config";
import { GeneratorError } from "./errors";
import type { Generator, GeneratorCategory } from "./generator";
import type {
	AddDependencies,
	AddScripts,
	AppendLines,
	CreateFile,
	CreateJson,
	Dependency,
	FileOperation,
	FilePath,
	MergeJson,
} from "./operations";

export const appSlotNames = {
	layout: "layout",
	page: "page",
	api: "api",
	trpc: "trpc",
	db: "db",
	auth: "auth",
	authClient: "authClient",
} as const;

export type AppSlotName = (typeof appSlotNames)[keyof typeof appSlotNames];

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

export const projectSurfaceNames = {
	rootPackageJson: "rootPackageJson",
	rootTsconfig: "rootTsconfig",
	workspaceConfig: "workspaceConfig",
	biomeConfig: "biomeConfig",
	gitignore: "gitignore",
} as const;

export type ProjectSurfaceName =
	(typeof projectSurfaceNames)[keyof typeof projectSurfaceNames];

export const appManagedSurfaceNames = {
	packageJson: "packageJson",
	tsconfig: "tsconfig",
	env: "env",
	envExample: "envExample",
	frameworkConfig: "frameworkConfig",
} as const;

export type AppManagedSurfaceName =
	(typeof appManagedSurfaceNames)[keyof typeof appManagedSurfaceNames];

export type AppSurfaceName = AppSlotName | AppManagedSurfaceName;

export const packageManagedSurfaceNames = {
	packageJson: "packageJson",
	tsconfig: "tsconfig",
} as const;

export type PackageManagedSurfaceName =
	(typeof packageManagedSurfaceNames)[keyof typeof packageManagedSurfaceNames];

export type PackageSurfaceName = PackageSlotName | PackageManagedSurfaceName;

export type ManagedSurfaceName =
	| AppSurfaceName
	| PackageSurfaceName
	| ProjectSurfaceName;

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

export interface TemplateModuleTarget<Id extends TemplateId = TemplateId> {
	readonly _tag: "TemplateModuleTarget";
	readonly template: TemplateRef<Id>;
}

export type ModuleTarget =
	| SelectedModuleTarget
	| EnsuredModuleTarget
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

export function templateModuleTarget<Id extends TemplateId>(
	id: Id,
	version: number,
): TemplateModuleTarget<Id> {
	return { _tag: "TemplateModuleTarget", template: { id, version } };
}

export interface AppCompatibility<Framework extends FrameworkId = FrameworkId> {
	readonly frameworks?: ReadonlyArray<Framework>;
	readonly templates?: ReadonlyArray<TemplateRef>;
	readonly requiredSlots?: ReadonlyArray<AppSlotName>;
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

export interface TextFileContribution {
	readonly _tag: "TextFileContribution";
	readonly path: FilePath;
	readonly content: string;
}

export interface JsonFileContribution {
	readonly _tag: "JsonFileContribution";
	readonly path: FilePath;
	readonly value: Record<string, unknown>;
}

export interface DependencyContribution {
	readonly _tag: "DependencyContribution";
	readonly path: FilePath;
	readonly dependencies: ReadonlyArray<Dependency>;
}

export interface ScriptContribution {
	readonly _tag: "ScriptContribution";
	readonly path: FilePath;
	readonly scripts: Record<string, string>;
}

export interface EnvEntriesContribution {
	readonly _tag: "EnvEntriesContribution";
	readonly path: FilePath;
	readonly section: string;
	readonly entries: ReadonlyArray<string>;
}

export interface LinesContribution {
	readonly _tag: "LinesContribution";
	readonly path: FilePath;
	readonly lines: ReadonlyArray<string>;
	readonly section?: string;
	readonly position?: "start" | "end";
}

export interface ProviderWrapperContribution {
	readonly _tag: "ProviderWrapperContribution";
	readonly path: FilePath;
	readonly content: string;
}

export interface RouteHandlerContribution {
	readonly _tag: "RouteHandlerContribution";
	readonly path: FilePath;
	readonly content: string;
}

export interface CssContribution {
	readonly _tag: "CssContribution";
	readonly path: FilePath;
	readonly content: string;
}

export interface UtilityExportContribution {
	readonly _tag: "UtilityExportContribution";
	readonly path: FilePath;
	readonly content: string;
}

export interface DbSchemaContribution {
	readonly _tag: "DbSchemaContribution";
	readonly path: FilePath;
	readonly content: string;
}

export interface ConfigFragmentContribution {
	readonly _tag: "ConfigFragmentContribution";
	readonly path: FilePath;
	readonly value: Record<string, unknown>;
	readonly strategy: "deep" | "replace";
}

export interface PackageCapabilityContribution<
	Capability extends CapabilityId = CapabilityId,
> {
	readonly _tag: "PackageCapabilityContribution";
	readonly capabilities: ReadonlyArray<Capability>;
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
		| typeof appManagedSurfaceNames.packageJson
		| typeof packageManagedSurfaceNames.packageJson;
	readonly dependencies: ReadonlyArray<Dependency>;
}

export interface ManagedScriptsSurfaceContribution {
	readonly _tag: "ManagedScriptsSurfaceContribution";
	readonly target: TargetRef;
	readonly surface:
		| typeof projectSurfaceNames.rootPackageJson
		| typeof appManagedSurfaceNames.packageJson
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
	readonly path: string;
	readonly content: string;
}

export type Contribution<Capability extends CapabilityId = CapabilityId> =
	| TextFileContribution
	| JsonFileContribution
	| DependencyContribution
	| ScriptContribution
	| EnvEntriesContribution
	| LinesContribution
	| ProviderWrapperContribution
	| RouteHandlerContribution
	| CssContribution
	| UtilityExportContribution
	| DbSchemaContribution
	| ConfigFragmentContribution
	| PackageCapabilityContribution<Capability>
	| EnsureModuleContribution
	| ManagedTextSurfaceContribution
	| ManagedJsonSurfaceContribution
	| ManagedLinesSurfaceContribution
	| ManagedDependenciesSurfaceContribution
	| ManagedScriptsSurfaceContribution
	| ModuleCapabilitiesContribution<Capability>
	| LeafTextFileContribution;

export function textFile(
	path: FilePath,
	content: string,
): TextFileContribution {
	return { _tag: "TextFileContribution", path, content };
}

export function jsonFile(
	path: FilePath,
	value: Record<string, unknown>,
): JsonFileContribution {
	return { _tag: "JsonFileContribution", path, value };
}

export function dependencies(
	path: FilePath,
	items: ReadonlyArray<Dependency>,
): DependencyContribution {
	return { _tag: "DependencyContribution", path, dependencies: items };
}

export function scripts(
	path: FilePath,
	items: Record<string, string>,
): ScriptContribution {
	return { _tag: "ScriptContribution", path, scripts: items };
}

export function envEntries(
	path: FilePath,
	section: string,
	entries: ReadonlyArray<string>,
): EnvEntriesContribution {
	return { _tag: "EnvEntriesContribution", path, section, entries };
}

export function lines(
	path: FilePath,
	items: ReadonlyArray<string>,
	options?: {
		readonly position?: "start" | "end";
		readonly section?: string;
	},
): LinesContribution {
	return {
		_tag: "LinesContribution",
		path,
		lines: items,
		position: options?.position,
		section: options?.section,
	};
}

export function configFragment(
	path: FilePath,
	value: Record<string, unknown>,
	strategy: "deep" | "replace" = "deep",
): ConfigFragmentContribution {
	return { _tag: "ConfigFragmentContribution", path, value, strategy };
}

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
	strategy: "deep" | "replace" = "deep",
): ManagedJsonSurfaceContribution {
	return {
		_tag: "ManagedJsonSurfaceContribution",
		target,
		surface,
		value,
		strategy,
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
		| typeof appManagedSurfaceNames.packageJson
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
		| typeof appManagedSurfaceNames.packageJson
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
	path: string,
	content: string,
): LeafTextFileContribution {
	return { _tag: "LeafTextFileContribution", target, path, content };
}

export interface DefinitionContext<Config> {
	readonly config: Config;
}

type ContributionResult<Capability extends CapabilityId = CapabilityId> =
	| ReadonlyArray<Contribution<Capability>>
	| Promise<ReadonlyArray<Contribution<Capability>>>
	| Effect.Effect<
			ReadonlyArray<Contribution<Capability>>,
			GeneratorError,
			CommandProbe
	  >;

export interface DependencyRef {
	readonly id: AddonId | TemplateId;
	readonly type: "addon" | "template";
}

export interface FrameworkDefinition<
	Id extends FrameworkId = FrameworkId,
	Slot extends AppSlotName = AppSlotName,
> {
	readonly _tag: "FrameworkDefinition";
	readonly id: Id;
	readonly name: string;
	readonly slots: ReadonlyArray<Slot>;
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
	readonly frameworks: ReadonlyArray<FrameworkDefinition>;
	readonly templates: ReadonlyArray<TemplateDefinition<Config>>;
	readonly addons: ReadonlyArray<AddonDefinition<Config>>;
}

export function defineFramework<
	const Id extends FrameworkId,
	const Slots extends ReadonlyArray<AppSlotName>,
>(framework: {
	readonly id: Id;
	readonly name: string;
	readonly slots: Slots;
}): FrameworkDefinition<Id, Slots[number]> {
	return { _tag: "FrameworkDefinition", ...framework };
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

export function defineRegistry<Config>(
	registry: DefinitionRegistry<Config>,
): DefinitionRegistry<Config> {
	return registry;
}

function normalizeContributionResult<Capability extends CapabilityId>(
	definitionId: string,
	result: ContributionResult<Capability>,
): Effect.Effect<
	ReadonlyArray<Contribution<Capability>>,
	GeneratorError,
	CommandProbe
> {
	if (Effect.isEffect(result)) return result;
	if (result instanceof Promise)
		return Effect.tryPromise({
			try: () => result,
			catch: (error) =>
				new GeneratorError({
					generatorId: definitionId,
					message: `Definition Failed: ${error instanceof Error ? error.message : String(error)}`,
				}),
		});

	return Effect.succeed(result);
}

function createFileOperation(
	path: FilePath,
	content: string,
): ReadonlyArray<CreateFile> {
	return [{ _tag: "CreateFile", path, content }];
}

function createJsonOperation(
	path: FilePath,
	value: Record<string, unknown>,
): ReadonlyArray<CreateJson> {
	return [{ _tag: "CreateJson", path, value }];
}

function createDependenciesOperation(
	path: FilePath,
	items: ReadonlyArray<Dependency>,
): ReadonlyArray<AddDependencies> {
	return [{ _tag: "AddDependencies", path, dependencies: items }];
}

function createScriptsOperation(
	path: FilePath,
	items: Record<string, string>,
): ReadonlyArray<AddScripts> {
	return [{ _tag: "AddScripts", path, scripts: items }];
}

function createAppendLinesOperation(
	contribution: EnvEntriesContribution | LinesContribution,
): ReadonlyArray<AppendLines> {
	return [
		{
			_tag: "AppendLines",
			path: contribution.path,
			lines:
				contribution._tag === "EnvEntriesContribution"
					? contribution.entries
					: contribution.lines,
			position:
				contribution._tag === "LinesContribution"
					? contribution.position
					: undefined,
			section: contribution.section,
		},
	];
}

function createMergeJsonOperation(
	path: FilePath,
	value: Record<string, unknown>,
	strategy: "deep" | "replace",
): ReadonlyArray<MergeJson> {
	return [{ _tag: "MergeJson", path, value, strategy }];
}

function lowerContribution(
	_definitionId: string,
	contribution: Contribution,
): Effect.Effect<ReadonlyArray<FileOperation>, GeneratorError> {
	switch (contribution._tag) {
		case "TextFileContribution":
		case "ProviderWrapperContribution":
		case "RouteHandlerContribution":
		case "CssContribution":
		case "UtilityExportContribution":
		case "DbSchemaContribution":
			return Effect.succeed(
				createFileOperation(contribution.path, contribution.content),
			);

		case "JsonFileContribution":
			return Effect.succeed(
				createJsonOperation(contribution.path, contribution.value),
			);

		case "DependencyContribution":
			return Effect.succeed(
				createDependenciesOperation(
					contribution.path,
					contribution.dependencies,
				),
			);

		case "ScriptContribution":
			return Effect.succeed(
				createScriptsOperation(contribution.path, contribution.scripts),
			);

		case "EnvEntriesContribution":
		case "LinesContribution":
			return Effect.succeed(createAppendLinesOperation(contribution));

		case "ConfigFragmentContribution":
			return Effect.succeed(
				createMergeJsonOperation(
					contribution.path,
					contribution.value,
					contribution.strategy,
				),
			);

		case "PackageCapabilityContribution":
		case "EnsureModuleContribution":
		case "ManagedTextSurfaceContribution":
		case "ManagedJsonSurfaceContribution":
		case "ManagedLinesSurfaceContribution":
		case "ManagedDependenciesSurfaceContribution":
		case "ManagedScriptsSurfaceContribution":
		case "ModuleCapabilitiesContribution":
		case "LeafTextFileContribution":
			return Effect.succeed([]);
	}
}

export function lowerContributions(
	definitionId: string,
	contributions: ReadonlyArray<Contribution>,
): Effect.Effect<ReadonlyArray<FileOperation>, GeneratorError> {
	return Effect.forEach(contributions, (contribution) =>
		lowerContribution(definitionId, contribution),
	).pipe(Effect.map((groups) => groups.flat()));
}

function templateMatches<Config>(
	expected: TemplateRef,
	template: TemplateDefinition<Config>,
): boolean {
	return expected.id === template.id && expected.version === template.version;
}

function frameworkHasRequiredSlots(
	framework: FrameworkDefinition,
	requiredSlots: ReadonlyArray<AppSlotName>,
): boolean {
	return requiredSlots.every((slot) => framework.slots.includes(slot));
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
): boolean {
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
					(template.id === module.template.id ||
						template.id.endsWith(`/${module.template.id}`)) &&
					template.version === module.template.version,
			)
		)
			return false;

		if (
			appCompatibility.requiredSlots &&
			!appCompatibility.requiredSlots.every((slot) => slot in module.slots)
		)
			return false;

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

function validateAddonAgainstSelection<Config>(
	addon: AddonDefinition<Config>,
	framework: FrameworkDefinition | undefined,
	template: TemplateDefinition<Config> | undefined,
): Effect.Effect<void, GeneratorError> {
	const compatibility = addon.compatibility;
	if (!compatibility?.app) return Effect.void;

	if (!framework || !template)
		return Effect.fail(
			new GeneratorError({
				generatorId: addon.id,
				message: "Template Required",
			}),
		);

	if (
		compatibility.app.frameworks &&
		!compatibility.app.frameworks.includes(framework.id)
	)
		return Effect.fail(
			new GeneratorError({
				generatorId: addon.id,
				message: "Framework Compatibility Failed",
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
				message: "Template Compatibility Failed",
			}),
		);

	if (
		compatibility.app.requiredSlots &&
		!frameworkHasRequiredSlots(framework, compatibility.app.requiredSlots)
	)
		return Effect.fail(
			new GeneratorError({
				generatorId: addon.id,
				message: "Required Slots Missing",
			}),
		);

	return Effect.void;
}

function lowerTemplateDefinition<Config>(
	template: TemplateDefinition<Config>,
): Generator<Config> {
	return {
		id: template.id,
		name: template.name,
		version: String(template.version),
		category: template.category,
		exclusive: template.exclusive,
		dependencies: template.dependencies.map((dependency) => dependency.id),
		appliesTo: () => true,
		generate: (config) =>
			normalizeContributionResult(
				template.id,
				template.contribute({ config }),
			).pipe(
				Effect.flatMap((contributions) =>
					lowerContributions(template.id, contributions),
				),
			),
	};
}

function lowerAddonDefinition<Config>(
	addon: AddonDefinition<Config>,
): Generator<Config> {
	return {
		id: addon.id,
		name: addon.name,
		version: addon.version,
		category: addon.category,
		exclusive: addon.exclusive,
		dependencies: addon.dependencies.map((dependency) => dependency.id),
		appliesTo: () => true,
		generate: (config) =>
			normalizeContributionResult(addon.id, addon.contribute({ config })).pipe(
				Effect.flatMap((contributions) =>
					lowerContributions(addon.id, contributions),
				),
			),
	};
}

export function resolveDefinitions<Config>(
	config: Config,
	registry: DefinitionRegistry<Config>,
): Effect.Effect<ReadonlyArray<Generator<Config>>, GeneratorError> {
	return Effect.gen(function* () {
		const templates = registry.templates.filter((template) =>
			template.when(config),
		);

		if (templates.length > 1)
			return yield* new GeneratorError({
				generatorId: "registry",
				message: "Multiple Templates Selected",
			});

		const template = templates[0];
		const framework = template
			? registry.frameworks.find((entry) => entry.id === template.framework)
			: undefined;

		if (template && !framework)
			return yield* new GeneratorError({
				generatorId: template.id,
				message: "Framework Definition Missing",
			});

		const addons = registry.addons.filter((addon) => addon.when(config));
		for (const addon of addons)
			yield* validateAddonAgainstSelection(addon, framework, template);

		const resolved: Generator<Config>[] = [];

		if (template) resolved.push(lowerTemplateDefinition(template));
		for (const addon of addons) resolved.push(lowerAddonDefinition(addon));

		return resolved;
	});
}
