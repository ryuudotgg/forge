import { createRequire, findPackageJSON } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import {
	type AdapterDefinition,
	type AddonDefinition,
	authoringApiVersion,
	type DependencyRef,
	defineRegistry,
	type FrameworkDefinition,
	RegistryDescriptorSchema,
	RegistryError,
	type TemplateDefinition,
	type TemplateRef,
} from "@ryuujs/core";
import { Effect, Either, Schema } from "effect";
import type { ForgeConfig } from "../config";
import { firstPartyCatalog, firstPartyRegistry } from "./first-party";
import type {
	AddonCatalogEntry,
	CatalogEntry,
	LoadedAddonDefinition,
	LoadedDefinitionRegistry,
	RegistryDescriptor,
	RegistryUnit,
} from "./types";
import {
	addonCatalogEntry,
	decodeRegistryPackageManifest,
	RegistryPackageManifestSchema,
} from "./types";

export class RegistryLoadError extends Schema.TaggedError<RegistryLoadError>()(
	"RegistryLoadError",
	{
		detail: Schema.optional(Schema.String),
		message: Schema.String,
		registryId: Schema.String,
	},
) {}

class RegistryPackageResolutionError extends Schema.TaggedError<RegistryPackageResolutionError>()(
	"RegistryPackageResolutionError",
	{ detail: Schema.String, message: Schema.String },
) {}

class RegistryPackageExecutionError extends Schema.TaggedError<RegistryPackageExecutionError>()(
	"RegistryPackageExecutionError",
	{ detail: Schema.String, message: Schema.String },
) {}

export interface RegistryPackageImport {
	readonly integrity?: string;
	readonly module: unknown;
	readonly version: string;
}

export type RegistryPackageImporter = (
	id: string,
	projectRoot: string,
) => Promise<RegistryPackageImport>;

export interface LoadDefinitionRegistryOptions {
	readonly importRegistry?: RegistryPackageImporter;
	readonly projectRoot: string;
	readonly registries: ReadonlyArray<string>;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
	return typeof value === "object" && value !== null;
}

const DependencyRefSchema = Schema.Struct({
	id: Schema.String,
	type: Schema.Literal("addon", "template"),
});

const TemplateRefSchema = Schema.Struct({
	id: Schema.String,
	version: Schema.Number,
});

const CompatibilitySchema = Schema.Struct({
	app: Schema.optional(
		Schema.Struct({
			frameworks: Schema.optional(Schema.Array(Schema.String)),
			requiredSlots: Schema.optional(Schema.Array(Schema.String)),
			templates: Schema.optional(Schema.Array(TemplateRefSchema)),
		}),
	),
	package: Schema.optional(
		Schema.Struct({
			capabilities: Schema.optional(Schema.Array(Schema.String)),
			requiredSlots: Schema.optional(Schema.Array(Schema.String)),
		}),
	),
});

const AddonDefinitionDataSchema = Schema.Struct({
	_tag: Schema.Literal("AddonDefinition"),
	category: Schema.String,
	compatibility: Schema.optional(CompatibilitySchema),
	contribute: Schema.Unknown,
	dependencies: Schema.Array(DependencyRefSchema),
	exclusive: Schema.Boolean,
	id: Schema.String,
	name: Schema.String,
	targetMode: Schema.Literal("single", "multiple"),
	version: Schema.String,
	when: Schema.Unknown,
});

const AdapterDefinitionDataSchema = Schema.Struct({
	_tag: Schema.Literal("AdapterDefinition"),
	addon: Schema.String,
	contribute: Schema.Unknown,
	framework: Schema.String,
	requiredSlots: Schema.Array(Schema.String),
});

const FrameworkDefinitionDataSchema = Schema.Struct({
	_tag: Schema.Literal("FrameworkDefinition"),
	buildOutputs: Schema.Array(Schema.String),
	configFile: Schema.String,
	id: Schema.String,
	ignoreDirs: Schema.Array(Schema.String),
	name: Schema.String,
	slots: Schema.Array(Schema.String),
	tsconfigPreset: Schema.Struct({
		content: Schema.Record({ key: Schema.String, value: Schema.Unknown }),
		name: Schema.String,
	}),
});

const TemplateDefinitionDataSchema = Schema.Struct({
	_tag: Schema.Literal("TemplateDefinition"),
	category: Schema.String,
	contribute: Schema.Unknown,
	dependencies: Schema.Array(DependencyRefSchema),
	exclusive: Schema.Boolean,
	framework: Schema.String,
	id: Schema.String,
	name: Schema.String,
	version: Schema.Number,
	when: Schema.Unknown,
});

function isAddonDefinition(
	value: unknown,
): value is AddonDefinition<ForgeConfig> {
	return (
		Schema.is(AddonDefinitionDataSchema)(value) &&
		typeof value.when === "function" &&
		typeof value.contribute === "function"
	);
}

function isAdapterDefinition(
	value: unknown,
): value is AdapterDefinition<ForgeConfig> {
	return (
		Schema.is(AdapterDefinitionDataSchema)(value) &&
		typeof value.contribute === "function"
	);
}

function isFrameworkDefinition(value: unknown): value is FrameworkDefinition {
	return Schema.is(FrameworkDefinitionDataSchema)(value);
}

function isTemplateDefinition(
	value: unknown,
): value is TemplateDefinition<ForgeConfig> {
	return (
		Schema.is(TemplateDefinitionDataSchema)(value) &&
		typeof value.when === "function" &&
		typeof value.contribute === "function"
	);
}

function moduleDefault(module: unknown): unknown {
	const outerDefault = isRecord(module) ? module.default : undefined;
	if (
		isRecord(outerDefault) &&
		Schema.is(RegistryPackageManifestSchema)(outerDefault.default)
	)
		return outerDefault.default;

	return outerDefault;
}

function packageVersion(value: unknown): string | undefined {
	if (!isRecord(value)) return undefined;
	return typeof value.version === "string" ? value.version : undefined;
}

function packageExports(value: unknown): unknown {
	return isRecord(value) ? value.exports : undefined;
}

function rootExport(value: unknown): unknown {
	if (!isRecord(value)) return value;
	if ("." in value) return value["."];
	if (Object.keys(value).some((key) => key.startsWith("."))) return undefined;
	return value;
}

function exportTarget(value: unknown): string | undefined {
	if (typeof value === "string") return value;
	if (Array.isArray(value)) {
		for (const alternative of value) {
			const target = exportTarget(alternative);
			if (target !== undefined) return target;
		}

		return undefined;
	}

	if (!isRecord(value)) return undefined;

	for (const condition of ["import", "default"]) {
		const target = exportTarget(value[condition]);
		if (target !== undefined) return target;
	}

	for (const [condition, nested] of Object.entries(value)) {
		if (condition === "import" || condition === "default") continue;

		const target = exportTarget(nested);
		if (target !== undefined) return target;
	}

	return undefined;
}

function isPackagePathNotExported(error: unknown): boolean {
	return isRecord(error) && error.code === "ERR_PACKAGE_PATH_NOT_EXPORTED";
}

export async function importRegistryPackage(
	id: string,
	projectRoot: string,
): Promise<RegistryPackageImport> {
	const projectRequire = createRequire(join(projectRoot, "package.json"));
	const projectPackageUrl = pathToFileURL(join(projectRoot, "package.json"));

	let packagePath: string;
	try {
		const locatedPackagePath = findPackageJSON(id, projectPackageUrl);

		const packageNotFound = new Error(`Registry package not found: ${id}`);
		if (locatedPackagePath === undefined) throw packageNotFound;

		packagePath = locatedPackagePath;
	} catch (error) {
		throw new RegistryPackageResolutionError({
			detail: errorMessage(error),
			message: errorMessage(error),
		});
	}

	let version: string;
	let packageMetadata: unknown;
	try {
		packageMetadata = projectRequire(packagePath);

		const packageMetadataVersion = packageVersion(packageMetadata);
		if (packageMetadataVersion === undefined)
			throw new Error(`Registry Package Version Missing: ${id}`);

		version = packageMetadataVersion;
	} catch (error) {
		throw new RegistryPackageExecutionError({
			detail: errorMessage(error),
			message: errorMessage(error),
		});
	}

	let entryPath: string;
	try {
		entryPath = projectRequire.resolve(id);
	} catch (error) {
		const resolutionError = new RegistryPackageResolutionError({
			detail: errorMessage(error),
			message: errorMessage(error),
		});

		if (!isPackagePathNotExported(error)) throw resolutionError;

		const target = exportTarget(rootExport(packageExports(packageMetadata)));
		if (target === undefined) throw resolutionError;

		entryPath = join(dirname(packagePath), target);
	}

	let module: unknown;
	try {
		module = await import(pathToFileURL(entryPath).href);
	} catch (error) {
		throw new RegistryPackageExecutionError({
			detail: errorMessage(error),
			message: errorMessage(error),
		});
	}

	return {
		module,
		version,
	};
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function registryError(id: string, message: string, detail?: string) {
	return new RegistryLoadError({
		...(detail === undefined ? {} : { detail }),
		message,
		registryId: id,
	});
}

function scopedUnitId(id: string): boolean {
	return /^@[^/\s]+\/[^/\s]+$/.test(id);
}

function validateUnits<Unit>(
	registryId: string,
	values: ReadonlyArray<unknown> | undefined,
	predicate: (value: unknown) => value is Unit,
): Effect.Effect<ReadonlyArray<Unit>, RegistryLoadError> {
	const units = values ?? [];
	if (!units.every(predicate))
		return Effect.fail(
			registryError(registryId, `Registry Package Invalid: ${registryId}`),
		);

	return Effect.succeed(units);
}

function validateScopedIds(
	registryId: string,
	ids: ReadonlyArray<unknown>,
): Effect.Effect<void, RegistryLoadError> {
	if (ids.every((id) => typeof id === "string" && scopedUnitId(id)))
		return Effect.void;

	const invalidId = ids.find(
		(id) => typeof id !== "string" || !scopedUnitId(id),
	);

	return Effect.fail(
		registryError(registryId, `Registry Unit Id Invalid: ${String(invalidId)}`),
	);
}

function validateRegistry(
	registryId: string,
	registry: Parameters<typeof defineRegistry<ForgeConfig>>[0],
): Effect.Effect<LoadedDefinitionRegistry["registry"], RegistryLoadError> {
	return Effect.try({
		try: () => defineRegistry(registry),
		catch: (error) =>
			registryError(
				registryId,
				error instanceof RegistryError
					? error.message
					: `Registry Registration Failed: ${errorMessage(error)}`,
			),
	});
}

function registryUnits(
	addons: ReadonlyArray<AddonDefinition<ForgeConfig>>,
	adapters: ReadonlyArray<AdapterDefinition<ForgeConfig>>,
	frameworks: ReadonlyArray<FrameworkDefinition>,
	templates: ReadonlyArray<TemplateDefinition<ForgeConfig>>,
): ReadonlyArray<RegistryUnit> {
	return [
		...addons.map((entry): RegistryUnit => ({ id: entry.id, kind: "addon" })),
		...adapters.map(
			(entry): RegistryUnit => ({
				addon: entry.addon,
				framework: entry.framework,
				kind: "adapter",
			}),
		),
		...frameworks.map(
			(entry): RegistryUnit => ({
				id: entry.id,
				kind: "framework",
			}),
		),
		...templates.map(
			(entry): RegistryUnit => ({ id: entry.id, kind: "template" }),
		),
	];
}

function refreshCatalog(
	catalogEntries: ReadonlyArray<CatalogEntry>,
	registry: LoadedDefinitionRegistry["registry"],
): ReadonlyArray<CatalogEntry> {
	return catalogEntries.map((entry) => {
		if (entry.kind !== "addon") return entry;
		const addon = registry.addons.find(
			(definition) => definition.id === entry.id,
		);

		return addon === undefined
			? entry
			: addonCatalogEntry(addon, entry, registry.adapters);
	});
}

function loadThirdPartyRegistries(
	options: LoadDefinitionRegistryOptions,
): Effect.Effect<LoadedDefinitionRegistry, RegistryLoadError> {
	return Effect.gen(function* () {
		const addons = [...firstPartyRegistry.addons];
		const adapters = [...firstPartyRegistry.adapters];
		const frameworks = [...firstPartyRegistry.frameworks];
		const templates = [...firstPartyRegistry.templates];

		const catalogEntries: CatalogEntry[] = [...firstPartyCatalog];
		const descriptors: RegistryDescriptor[] = [];

		const importer = options.importRegistry ?? importRegistryPackage;

		const seenRegistryIds = new Set<string>();
		for (const registryId of options.registries) {
			if (seenRegistryIds.has(registryId))
				return yield* registryError(
					registryId,
					`Registry Duplicate: ${registryId}`,
				);

			seenRegistryIds.add(registryId);
		}

		let registry = yield* validateRegistry("first-party", {
			addons,
			adapters,
			frameworks,
			templates,
		});

		for (const registryId of options.registries) {
			const imported = yield* Effect.tryPromise({
				try: () => importer(registryId, options.projectRoot),
				catch: (error) =>
					error instanceof RegistryPackageExecutionError
						? registryError(
								registryId,
								`Registry Import Failed: ${registryId}: ${error.detail}`,
								error.detail,
							)
						: registryError(
								registryId,
								`Registry Not Installed: ${registryId}`,
								error instanceof RegistryPackageResolutionError
									? error.detail
									: errorMessage(error),
							),
			});

			const decoded = yield* decodeRegistryPackageManifest(
				moduleDefault(imported.module),
			).pipe(
				Effect.mapError(() =>
					registryError(registryId, `Registry Package Invalid: ${registryId}`),
				),
			);

			if (decoded.apiVersion !== authoringApiVersion)
				return yield* registryError(
					registryId,
					`Registry Api Version Unsupported: ${registryId} expected ${authoringApiVersion}, found ${decoded.apiVersion}`,
				);

			const loadedAddons = yield* validateUnits(
				registryId,
				decoded.addons,
				isAddonDefinition,
			);

			const loadedAdapters = yield* validateUnits(
				registryId,
				decoded.adapters,
				isAdapterDefinition,
			);

			const loadedFrameworks = yield* validateUnits(
				registryId,
				decoded.frameworks,
				isFrameworkDefinition,
			);

			const loadedTemplates = yield* validateUnits(
				registryId,
				decoded.templates,
				isTemplateDefinition,
			);

			yield* validateScopedIds(registryId, [
				...loadedAddons.map((entry) => entry.id),
				...loadedFrameworks.map((entry) => entry.id),
				...loadedTemplates.map((entry) => entry.id),
				...decoded.catalog.map((entry) => entry.id),
			]);

			addons.push(...loadedAddons);
			adapters.push(...loadedAdapters);
			frameworks.push(...loadedFrameworks);
			templates.push(...loadedTemplates);

			catalogEntries.push(...decoded.catalog);

			registry = yield* validateRegistry(registryId, {
				addons,
				adapters,
				frameworks,
				templates,
			});

			const descriptor = yield* Schema.decodeUnknown(RegistryDescriptorSchema)({
				apiVersion: decoded.apiVersion,
				id: registryId,
				...(imported.integrity === undefined
					? {}
					: { integrity: imported.integrity }),
				source: "npm",
				units: registryUnits(
					loadedAddons,
					loadedAdapters,
					loadedFrameworks,
					loadedTemplates,
				),
				version: imported.version,
			}).pipe(
				Effect.mapError(() =>
					registryError(registryId, `Registry Package Invalid: ${registryId}`),
				),
			);

			descriptors.push(descriptor);
		}

		return {
			catalog: refreshCatalog(catalogEntries, registry),
			descriptors,
			registry,
		};
	});
}

export const catalog = firstPartyCatalog;

export function listCatalogEntries(kind?: CatalogEntry["kind"]) {
	return kind
		? firstPartyCatalog.filter((entry) => entry.kind === kind)
		: [...firstPartyCatalog];
}

export function getCatalogEntry(id: string) {
	return firstPartyCatalog.find((entry) => entry.id === id);
}

export function listVisibleAddons() {
	return firstPartyCatalog.filter(
		(entry): entry is AddonCatalogEntry =>
			entry.kind === "addon" && entry.available && entry.hidden === false,
	);
}

export function loadAddonDefinition(id: string): LoadedAddonDefinition {
	const addon = firstPartyRegistry.addons.find((entry) => entry.id === id);
	if (!addon) throw registryError(id, `Addon Not Found: ${id}`);

	return {
		addon,
		catalogEntry: firstPartyCatalog.find(
			(entry): entry is AddonCatalogEntry =>
				entry.kind === "addon" && entry.id === id,
		),
	};
}

export function loadDefinitionRegistry(
	options: LoadDefinitionRegistryOptions,
): Promise<LoadedDefinitionRegistry>;
export function loadDefinitionRegistry(): LoadedDefinitionRegistry;
export function loadDefinitionRegistry(
	options?: LoadDefinitionRegistryOptions,
): LoadedDefinitionRegistry | Promise<LoadedDefinitionRegistry> {
	if (options !== undefined) {
		const load = async () => {
			const result = await Effect.runPromise(
				Effect.either(loadThirdPartyRegistries(options)),
			);

			if (Either.isRight(result)) return result.right;
			throw result.left;
		};

		return load();
	}

	return {
		catalog: firstPartyCatalog,
		descriptors: [],
		registry: firstPartyRegistry,
	};
}

export interface RemovalBlockers {
	readonly dependents: ReadonlyArray<AddonDefinition<ForgeConfig>>;
	readonly frameworks: ReadonlyArray<string>;
}

export function findRemovalBlockers(
	addonId: string,
	config: ForgeConfig,
	installedIds: ReadonlyArray<string>,
	moduleTemplates: ReadonlyArray<TemplateRef>,
): RemovalBlockers {
	const removed = firstPartyRegistry.addons.find(
		(entry) => entry.id === addonId,
	);

	if (!removed) return { dependents: [], frameworks: [] };

	const byId = new Map(
		firstPartyRegistry.addons.map((entry) => [entry.id, entry]),
	);

	const blocksRemoval = (dependent: {
		readonly dependencies: ReadonlyArray<DependencyRef>;
	}) => {
		const dependsOnRemoved = dependent.dependencies.some(
			(dependency) => dependency.type === "addon" && dependency.id === addonId,
		);

		if (!dependsOnRemoved) return false;

		return !dependent.dependencies.some((dependency) => {
			if (dependency.type !== "addon" || dependency.id === addonId)
				return false;

			const alternative = byId.get(dependency.id);
			return (
				alternative !== undefined &&
				alternative.category === removed.category &&
				alternative.when(config)
			);
		});
	};

	const dependents = installedIds.flatMap((installedId) => {
		if (installedId === addonId) return [];

		const installed = byId.get(installedId);
		return installed && blocksRemoval(installed) ? [installed] : [];
	});

	const frameworks = [
		...new Set(
			firstPartyRegistry.templates
				.filter(
					(template) =>
						moduleTemplates.some(
							(moduleTemplate) =>
								template.id === moduleTemplate.id &&
								template.version === moduleTemplate.version,
						) && blocksRemoval(template),
				)
				.map(
					(template) =>
						firstPartyRegistry.frameworks.find(
							(framework) => framework.id === template.framework,
						)?.name ?? template.framework,
				),
		),
	];

	return { dependents, frameworks };
}
