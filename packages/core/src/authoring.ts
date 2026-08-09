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

export class SlotPathError extends Schema.TaggedErrorClass<SlotPathError>()(
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
	readonly sourceRoot: string;
	readonly slots: ReadonlyArray<Slot>;
	readonly tsconfigPreset: {
		readonly content: Record<string, unknown>;
		readonly name: string;
	};
}

export interface RequiredMarker {
	readonly _tag: "RequiredMarker";
}

export interface ToggleLineMarker<Carrier extends string = string> {
	readonly _tag: "ToggleLineMarker";
	readonly carrier: Carrier;
}

export interface ToggleInlineMarker<Carrier extends string = string> {
	readonly _tag: "ToggleInlineMarker";
	readonly carrier: Carrier;
}

export type TemplateMarker =
	| RequiredMarker
	| ToggleLineMarker
	| ToggleInlineMarker;

const requiredMarker: RequiredMarker = { _tag: "RequiredMarker" };

export const marker = {
	required: requiredMarker,
	toggleLine<const Carrier extends string>(
		carrier: Carrier,
	): ToggleLineMarker<Carrier> {
		return { _tag: "ToggleLineMarker", carrier };
	},
	toggleInline<const Carrier extends string>(
		carrier: Carrier,
	): ToggleInlineMarker<Carrier> {
		return { _tag: "ToggleInlineMarker", carrier };
	},
};

export interface SourceRootDestination<Path extends string = string> {
	readonly _tag: "SourceRootDestination";
	readonly relativePath: Path;
}

export interface ModuleDestination<Path extends string = string> {
	readonly _tag: "ModuleDestination";
	readonly relativePath: Path;
}

export type TemplateAssetDestination =
	| SourceRootDestination
	| ModuleDestination;

export function inSourceRoot<const Path extends string>(
	relativePath: Path,
): SourceRootDestination<Path> {
	return { _tag: "SourceRootDestination", relativePath };
}

export function inModule<const Path extends string>(
	relativePath: Path,
): ModuleDestination<Path> {
	return { _tag: "ModuleDestination", relativePath };
}

export interface SharedAssetDefinition<
	Name extends string = string,
	Template extends string = string,
	Destination extends TemplateAssetDestination = TemplateAssetDestination,
> {
	readonly _tag: "SharedAssetDefinition";
	readonly name: Name;
	readonly template: Template;
	readonly destination: Destination;
}

export interface VariantAssetDefinition<
	Name extends string = string,
	Destination extends TemplateAssetDestination = TemplateAssetDestination,
	Variants extends Readonly<Record<string, string>> = Readonly<
		Record<string, string>
	>,
> {
	readonly _tag: "VariantAssetDefinition";
	readonly name: Name;
	readonly destination: Destination;
	readonly variants: Variants;
}

export interface SlotAssetDefinition<
	Slot extends string = string,
	Variants extends Readonly<Record<string, string>> = Readonly<
		Record<string, string>
	>,
> {
	readonly _tag: "SlotAssetDefinition";
	readonly name: Slot;
	readonly slot: Slot;
	readonly variants: Variants;
}

export type TemplateAssetDefinition =
	| SharedAssetDefinition
	| VariantAssetDefinition
	| SlotAssetDefinition;

export function sharedAsset<
	const Name extends string,
	const Template extends string,
	const Destination extends TemplateAssetDestination,
>(
	name: Name,
	asset: {
		readonly template: Template;
		readonly destination: Destination;
	},
): SharedAssetDefinition<Name, Template, Destination> {
	return { _tag: "SharedAssetDefinition", name, ...asset };
}

export function variantAsset<
	const Name extends string,
	const Destination extends TemplateAssetDestination,
	const Variants extends Readonly<Record<string, string>>,
>(
	name: Name,
	asset: {
		readonly destination: Destination;
		readonly variants: Variants;
	},
): VariantAssetDefinition<Name, Destination, Variants> {
	return { _tag: "VariantAssetDefinition", name, ...asset };
}

export function slotAsset<
	const Slot extends string,
	const Variants extends Readonly<Record<string, string>>,
>(
	slot: Slot,
	asset: { readonly variants: Variants },
): SlotAssetDefinition<Slot, Variants> {
	return { _tag: "SlotAssetDefinition", name: slot, slot, ...asset };
}

export interface TemplateRecipeDefinition<
	Addon extends AddonId = AddonId,
	Markers extends Readonly<Record<string, TemplateMarker>> = Readonly<
		Record<string, TemplateMarker>
	>,
	Assets extends
		ReadonlyArray<TemplateAssetDefinition> = ReadonlyArray<TemplateAssetDefinition>,
> {
	readonly _tag: "TemplateRecipeDefinition";
	readonly addon: Addon;
	readonly markers: Markers;
	readonly assets: Assets;
}

export function defineTemplateRecipe<
	const Addon extends AddonId,
	const Markers extends Readonly<Record<string, TemplateMarker>>,
	const Assets extends ReadonlyArray<TemplateAssetDefinition>,
>(recipe: {
	readonly addon: Addon;
	readonly markers: Markers;
	readonly assets: Assets;
}): TemplateRecipeDefinition<Addon, Markers, Assets> {
	return { _tag: "TemplateRecipeDefinition", ...recipe };
}

export type ReadTemplate = (path: string) => string;

export type RecipeMarkerValues<
	Markers extends Readonly<Record<string, TemplateMarker>>,
> = {
	readonly [Name in keyof Markers]: string;
};

export interface RenderRecipeValues<
	Markers extends Readonly<Record<string, TemplateMarker>> = Readonly<
		Record<string, TemplateMarker>
	>,
> {
	readonly markers: RecipeMarkerValues<Markers>;
	readonly readTemplate: ReadTemplate;
	readonly slots: Readonly<Record<string, string>>;
}

export interface RenderedRecipeAsset {
	readonly destination: string;
	readonly content: string;
}

const recipeMarkerPattern = /__[A-Z_]+?__/g;
const recipeMarkerNamePattern = /^[A-Z]+(?:_[A-Z]+)*$/;

function markerPattern(name: string): string {
	return `__${name}__`;
}

function markerReplacementKey(
	name: string,
	declaration: TemplateMarker,
): string {
	return declaration._tag === "RequiredMarker"
		? markerPattern(name)
		: declaration.carrier;
}

export function interpolate(
	template: string,
	values: Record<string, string>,
): string {
	return Object.entries(values).reduce(
		(result, [key, value]) =>
			result.replaceAll(key.includes("__") ? key : `__${key}__`, value),
		template,
	);
}

function variantTemplate(
	variants: Readonly<Record<string, string>>,
	frameworkId: string,
): string | undefined {
	return Object.entries(variants).find(([id]) => id === frameworkId)?.[1];
}

function templatePathForAsset(
	asset: TemplateAssetDefinition,
	frameworkId: string,
): string | undefined {
	return asset._tag === "SharedAssetDefinition"
		? asset.template
		: variantTemplate(asset.variants, frameworkId);
}

function destinationForAsset(
	asset: TemplateAssetDefinition,
	framework: FrameworkDefinition,
	slots?: Readonly<Record<string, string>>,
): string | undefined {
	if (asset._tag === "SlotAssetDefinition")
		return slots === undefined ? `slot:${asset.slot}` : slots[asset.slot];

	if (asset.destination._tag === "ModuleDestination")
		return asset.destination.relativePath;

	return framework.sourceRoot.length === 0
		? asset.destination.relativePath
		: `${framework.sourceRoot}/${asset.destination.relativePath}`;
}

function recipeReplacements(
	markers: Readonly<Record<string, TemplateMarker>>,
	values: Readonly<Record<string, string>>,
): Record<string, string> {
	const replacements: Record<string, string> = {};
	for (const [name, declaration] of Object.entries(markers))
		replacements[markerReplacementKey(name, declaration)] = values[name] ?? "";

	return replacements;
}

function recipeProbeValues(
	markers: Readonly<Record<string, TemplateMarker>>,
	disabledToggle?: string,
): Record<string, string> {
	const values: Record<string, string> = {};
	for (const [name, declaration] of Object.entries(markers)) {
		if (declaration._tag === "RequiredMarker") {
			values[name] = `probe-${name}`;
			continue;
		}

		values[declaration.carrier] =
			name === disabledToggle
				? ""
				: declaration._tag === "ToggleLineMarker"
					? `probe-${name}\n`
					: `probe-${name} `;
	}

	return values;
}

function throwRecipeMarkerError(
	reason:
		| "recipe-marker-missing"
		| "recipe-marker-undeclared"
		| "recipe-toggle-residue",
	recipe: TemplateRecipeDefinition,
	markerName: string,
	template?: string,
): never {
	throw new RegistryError({
		reason,
		registryId: recipe.addon,
		subject: `${markerName}:${template ?? ""}:${recipe.addon}`,
		addon: recipe.addon,
		marker: markerName,
		template,
	});
}

function throwRecipeMarkerInvalidError(
	recipe: TemplateRecipeDefinition,
	marker: string,
	detail: string,
): never {
	throw new RegistryError({
		reason: "recipe-marker-invalid",
		registryId: recipe.addon,
		subject: `${marker}:${recipe.addon}`,
		addon: recipe.addon,
		marker,
		detail,
	});
}

function validateRecipeMarkers(recipe: TemplateRecipeDefinition): void {
	const replacementKeys = new Map<string, string>();

	for (const [name, declaration] of Object.entries(recipe.markers)) {
		if (!recipeMarkerNamePattern.test(name))
			throwRecipeMarkerInvalidError(
				recipe,
				name,
				"name does not match the marker-name format",
			);

		const pattern = markerPattern(name);
		if (
			declaration._tag !== "RequiredMarker" &&
			!declaration.carrier.includes(pattern)
		)
			throwRecipeMarkerInvalidError(
				recipe,
				name,
				`carrier does not contain ${pattern}`,
			);

		const replacementKey = markerReplacementKey(name, declaration);
		const duplicate = replacementKeys.get(replacementKey);
		if (duplicate !== undefined)
			throwRecipeMarkerInvalidError(
				recipe,
				name,
				`replacement key duplicates ${duplicate}`,
			);

		replacementKeys.set(replacementKey, name);
	}
}

function validateAssetVariants(
	recipe: TemplateRecipeDefinition,
	asset: TemplateAssetDefinition,
	frameworks: ReadonlyArray<FrameworkDefinition>,
): void {
	if (asset._tag === "SharedAssetDefinition") return;

	for (const frameworkId of Object.keys(asset.variants)) {
		const framework = frameworks.find(({ id }) => id === frameworkId);
		if (framework === undefined)
			throw new RegistryError({
				reason: "recipe-framework-unknown",
				registryId: recipe.addon,
				subject: `${frameworkId}:${recipe.addon}`,
				addon: recipe.addon,
				framework: frameworkId,
			});

		if (
			asset._tag === "SlotAssetDefinition" &&
			!framework.slots.includes(asset.slot)
		)
			throw new RegistryError({
				reason: "recipe-slot-unknown",
				registryId: recipe.addon,
				subject: `${asset.slot}:${frameworkId}:${recipe.addon}`,
				addon: recipe.addon,
				framework: frameworkId,
				slot: asset.slot,
			});
	}
}

function destinationClaimKey(
	asset: TemplateAssetDefinition,
	framework: FrameworkDefinition,
	destination: string,
): string {
	return asset._tag === "SlotAssetDefinition"
		? `${framework.id}:\u0000${asset.slot}`
		: `${framework.id}:${destination}`;
}

export function validateTemplateRecipes(
	recipes: ReadonlyArray<TemplateRecipeDefinition>,
	frameworks: ReadonlyArray<FrameworkDefinition>,
	readTemplate: ReadTemplate,
): void {
	const destinations = new Set<string>();

	for (const recipe of recipes) {
		validateRecipeMarkers(recipe);
		for (const asset of recipe.assets)
			validateAssetVariants(recipe, asset, frameworks);
	}

	for (const recipe of recipes) {
		const templatePaths = new Set<string>();
		for (const asset of recipe.assets) {
			if (asset._tag === "SharedAssetDefinition")
				templatePaths.add(asset.template);
			else
				for (const templatePath of Object.values(asset.variants))
					templatePaths.add(templatePath);

			for (const framework of frameworks) {
				const templatePath = templatePathForAsset(asset, framework.id);
				if (templatePath === undefined) continue;

				const destination = destinationForAsset(asset, framework);
				if (destination === undefined) continue;

				const destinationKey = destinationClaimKey(
					asset,
					framework,
					destination,
				);

				if (destinations.has(destinationKey))
					throw new RegistryError({
						reason: "recipe-destination-collision",
						registryId: recipe.addon,
						subject: destinationKey,
						addon: recipe.addon,
						framework: framework.id,
						destination,
					});

				destinations.add(destinationKey);
			}
		}

		const templates = [...templatePaths].map((templatePath) => ({
			templatePath,
			template: readTemplate(templatePath),
		}));

		for (const [name, declaration] of Object.entries(recipe.markers)) {
			const pattern =
				declaration._tag === "RequiredMarker"
					? markerPattern(name)
					: declaration.carrier;

			if (!templates.some(({ template }) => template.includes(pattern)))
				throwRecipeMarkerError(
					"recipe-marker-missing",
					recipe,
					markerPattern(name),
				);
		}

		for (const { templatePath, template } of templates) {
			const declaredMarkers = new Set(
				Object.keys(recipe.markers).map(markerPattern),
			);

			for (const occurrence of template.matchAll(recipeMarkerPattern)) {
				const found = occurrence[0];
				if (!declaredMarkers.has(found))
					throwRecipeMarkerError(
						"recipe-marker-undeclared",
						recipe,
						found,
						templatePath,
					);
			}

			for (const [name, declaration] of Object.entries(recipe.markers)) {
				if (declaration._tag === "RequiredMarker") continue;

				for (const disabledToggle of [undefined, name]) {
					const rendered = interpolate(
						template,
						recipeProbeValues(recipe.markers, disabledToggle),
					);

					const residue = rendered.match(recipeMarkerPattern)?.[0];
					if (residue !== undefined)
						throwRecipeMarkerError(
							"recipe-toggle-residue",
							recipe,
							residue,
							templatePath,
						);
				}
			}
		}
	}
}

export function renderRecipeAsset<
	const Addon extends AddonId,
	const Markers extends Readonly<Record<string, TemplateMarker>>,
	const Assets extends ReadonlyArray<TemplateAssetDefinition>,
>(
	recipe: TemplateRecipeDefinition<Addon, Markers, Assets>,
	asset: Assets[number],
	framework: FrameworkDefinition,
	values: RenderRecipeValues<Markers>,
): RenderedRecipeAsset {
	const templatePath = templatePathForAsset(asset, framework.id);
	if (templatePath === undefined)
		throw new Error(
			`Recipe Variant Missing: ${asset.name} for ${framework.id} (${recipe.addon})`,
		);

	const destination = destinationForAsset(asset, framework, values.slots);
	if (destination === undefined) {
		const slot = asset._tag === "SlotAssetDefinition" ? asset.slot : "unknown";
		throw new Error(
			`Recipe Slot Missing: ${slot} for ${asset.name} (${recipe.addon})`,
		);
	}

	return {
		destination,
		content: interpolate(
			values.readTemplate(templatePath),
			recipeReplacements(recipe.markers, values.markers),
		),
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
	readonly recipes: ReadonlyArray<TemplateRecipeDefinition>;
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
	readonly sourceRoot: string;
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

type RegistryDefinitionInput<Config> = {
	readonly adapters?: ReadonlyArray<AdapterDefinition<Config>>;
	readonly frameworks: ReadonlyArray<FrameworkDefinition>;
	readonly templates: ReadonlyArray<TemplateDefinition<Config>>;
	readonly addons: ReadonlyArray<AddonDefinition<Config>>;
} & (
	| {
			readonly recipes?: undefined;
			readonly readTemplate?: undefined;
	  }
	| {
			readonly recipes: ReadonlyArray<TemplateRecipeDefinition>;
			readonly readTemplate: ReadTemplate;
	  }
);

export function defineRegistry<Config>(
	registry: RegistryDefinitionInput<Config>,
): DefinitionRegistry<Config> {
	const adapters = registry.adapters ?? [];
	const recipes = registry.recipes ?? [];

	const validateUniqueIds = (
		kind: "Addon" | "Framework" | "Template",
		entries: ReadonlyArray<{ readonly id: string }>,
	) => {
		const ids = new Set<string>();
		for (const entry of entries) {
			if (ids.has(entry.id))
				throw new RegistryError({
					reason: "duplicate",
					registryId: entry.id,
					subject: entry.id,
					kind,
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
				reason: "framework-slots-invalid",
				registryId: framework.id,
				subject: framework.id,
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
				reason: "adapter-duplicate",
				registryId: key,
				subject: key,
			});

		if (!addonIds.has(adapter.addon))
			throw new RegistryError({
				reason: "adapter-addon-missing",
				registryId: key,
				subject: adapter.addon,
			});

		if (!frameworkIds.has(adapter.framework))
			throw new RegistryError({
				reason: "adapter-framework-missing",
				registryId: key,
				subject: adapter.framework,
			});

		const framework = registry.frameworks.find(
			(entry) => entry.id === adapter.framework,
		);

		const invalidSlot = adapter.requiredSlots.find(
			(slot) => !framework?.slots.includes(slot),
		);

		if (invalidSlot)
			throw new RegistryError({
				reason: "adapter-slot-missing",
				registryId: key,
				subject: `${key}:${invalidSlot}`,
			});

		adapterKeys.add(key);
	}

	if (registry.recipes !== undefined)
		validateTemplateRecipes(
			registry.recipes,
			registry.frameworks,
			registry.readTemplate,
		);

	return {
		adapters,
		frameworks: registry.frameworks,
		templates: registry.templates,
		addons: registry.addons,
		recipes,
	};
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

export function deriveAddonFrameworks<Config>(
	addon: AddonDefinition<Config>,
	adapters: ReadonlyArray<AdapterDefinition<Config>> = [],
): ReadonlyArray<FrameworkId> | undefined {
	const appCompatibility = addon.compatibility?.app;
	if (appCompatibility && appCompatibility.frameworks === undefined)
		return undefined;

	const declaredFrameworks = appCompatibility?.frameworks;
	const frameworks: FrameworkId[] = [];

	for (const framework of declaredFrameworks ?? [])
		if (!frameworks.includes(framework)) frameworks.push(framework);

	for (const adapter of adapters)
		if (adapter.addon === addon.id && !frameworks.includes(adapter.framework))
			frameworks.push(adapter.framework);

	return frameworks.length > 0 || declaredFrameworks !== undefined
		? frameworks
		: undefined;
}

export function addonDeclaresFramework<Config>(
	addon: AddonDefinition<Config>,
	frameworkId: FrameworkId,
): boolean {
	const appCompatibility = addon.compatibility?.app;
	return (
		appCompatibility !== undefined &&
		(appCompatibility.frameworks === undefined ||
			appCompatibility.frameworks.includes(frameworkId))
	);
}

export function isAddonCompatibleWithModule<Config>(
	addon: AddonDefinition<Config>,
	module: AppConfig | PackageConfig,
	frameworks: ReadonlyArray<FrameworkDefinition> = [],
	adapters: ReadonlyArray<AdapterDefinition<Config>> = [],
): boolean {
	if (
		module.type === "app" &&
		adapters.some(
			(adapter) =>
				adapter.addon === addon.id && adapter.framework === module.framework,
		)
	)
		return true;

	const compatibility = addon.compatibility;
	if (!compatibility)
		return deriveAddonFrameworks(addon, adapters) === undefined;

	if (module.type === "app") {
		const appCompatibility = compatibility.app;
		if (!appCompatibility || !addonDeclaresFramework(addon, module.framework))
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
					reason: "framework-template-required",
					generatorName: addon.name,
				}),
			);

		if (addonAdapters.some((adapter) => adapter.framework === framework.id))
			return Effect.void;
	}

	const compatibility = addon.compatibility;
	if (!compatibility?.app)
		return addonAdapters.length > 0 &&
			compatibility?.package === undefined &&
			framework
			? Effect.fail(
					new GeneratorError({
						generatorId: addon.id,
						reason: "framework-not-supported-yet",
						generatorName: addon.name,
						frameworkName: framework.name,
					}),
				)
			: Effect.void;

	if (!framework || !template)
		return Effect.fail(
			new GeneratorError({
				generatorId: addon.id,
				reason: "framework-template-required",
				generatorName: addon.name,
			}),
		);

	if (!addonDeclaresFramework(addon, framework.id))
		return Effect.fail(
			new GeneratorError({
				generatorId: addon.id,
				reason: "framework-not-supported",
				generatorName: addon.name,
				frameworkName: framework.name,
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
				reason: "selected-template-not-supported",
				generatorName: addon.name,
				frameworkName: framework.name,
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

		return Effect.fail(
			new GeneratorError({
				generatorId: addon.id,
				reason: "required-slots-missing",
				generatorName: addon.name,
				frameworkName: framework.name,
				missingSlots,
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

	return Effect.fail(
		new GeneratorError({
			generatorId: addon.id,
			reason: "required-slots-missing",
			generatorName: addon.name,
			frameworkName: framework.name,
			missingSlots,
		}),
	);
}
