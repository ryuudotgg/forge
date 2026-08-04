import type {
	AdapterDefinition,
	AddonDefinition,
	CapabilityId,
	DefinitionRegistry,
	FrameworkDefinition,
	FrameworkId,
	ManagedSurfaceName,
	RegistryDescriptor,
	RegistryUnit,
	TargetMode,
	TemplateDefinition,
} from "@ryuujs/core";
import { addonDeclaresFramework, deriveAddonFrameworks } from "@ryuujs/core";
import { Schema } from "effect";
import type { ForgeConfig } from "../config";

export type CatalogKind = "addon" | "framework" | "template";

interface CatalogMetadataBase {
	readonly description: string;
	readonly docsUrl?: string;
	readonly experimental: boolean;
	readonly hidden: boolean;
	readonly id: string;
	readonly keywords: ReadonlyArray<string>;
	readonly kind: CatalogKind;
	readonly name: string;
	readonly summary: string;
}

export interface FirstPartyFrameworkMetadata extends CatalogMetadataBase {
	readonly kind: "framework";
}

export interface FirstPartyTemplateMetadata extends CatalogMetadataBase {
	readonly kind: "template";
}

export interface FirstPartyAddonMetadata extends CatalogMetadataBase {
	readonly kind: "addon";
}

interface CatalogEntryBase extends CatalogMetadataBase {
	readonly available: boolean;
	readonly category: string;
	readonly source: string;
}

export interface FrameworkCatalogEntry extends CatalogEntryBase {
	readonly kind: "framework";
	readonly slots: ReadonlyArray<string>;
}

export interface TemplateCatalogEntry extends CatalogEntryBase {
	readonly framework: string;
	readonly kind: "template";
	readonly version: number;
}

export interface AddonCatalogEntry extends CatalogEntryBase {
	readonly capabilities?: ReadonlyArray<CapabilityId>;
	readonly frameworks?: ReadonlyArray<FrameworkId>;
	readonly frameworkSources: Readonly<Record<string, string>>;
	readonly kind: "addon";
	readonly requiredSlots?: ReadonlyArray<ManagedSurfaceName>;
	readonly targetMode: TargetMode;
}

export type CatalogEntry =
	| AddonCatalogEntry
	| FrameworkCatalogEntry
	| TemplateCatalogEntry;

type RegistryAddonCatalogEntry = Omit<
	AddonCatalogEntry,
	"frameworkSources" | "source"
>;

type RegistryFrameworkCatalogEntry = Omit<FrameworkCatalogEntry, "source">;
type RegistryTemplateCatalogEntry = Omit<TemplateCatalogEntry, "source">;

export type RegistryCatalogEntry =
	| RegistryAddonCatalogEntry
	| RegistryFrameworkCatalogEntry
	| RegistryTemplateCatalogEntry;

const CatalogMetadataSchema = {
	available: Schema.Boolean,
	category: Schema.String,
	description: Schema.String,
	docsUrl: Schema.optional(Schema.String),
	experimental: Schema.Boolean,
	hidden: Schema.Boolean,
	id: Schema.String,
	keywords: Schema.Array(Schema.String),
	name: Schema.String,
	summary: Schema.String,
};

export const RegistryCatalogEntrySchema = Schema.Union(
	Schema.Struct({
		...CatalogMetadataSchema,
		kind: Schema.Literal("framework"),
		slots: Schema.Array(Schema.String),
	}),
	Schema.Struct({
		...CatalogMetadataSchema,
		framework: Schema.String,
		kind: Schema.Literal("template"),
		version: Schema.Number,
	}),
	Schema.Struct({
		...CatalogMetadataSchema,
		capabilities: Schema.optional(Schema.Array(Schema.String)),
		frameworks: Schema.optional(Schema.Array(Schema.String)),
		kind: Schema.Literal("addon"),
		requiredSlots: Schema.optional(Schema.Array(Schema.String)),
		targetMode: Schema.Literal("single", "multiple"),
	}),
);

export interface RegistryPackageManifest<Config> {
	readonly apiVersion: number;
	readonly adapters?: ReadonlyArray<AdapterDefinition<Config>>;
	readonly addons?: ReadonlyArray<AddonDefinition<Config>>;
	readonly frameworks?: ReadonlyArray<FrameworkDefinition>;
	readonly templates?: ReadonlyArray<TemplateDefinition<Config>>;
	readonly catalog: ReadonlyArray<RegistryCatalogEntry>;
}

export const RegistryPackageManifestSchema = Schema.Struct({
	apiVersion: Schema.Int,
	adapters: Schema.optional(Schema.Array(Schema.Unknown)),
	addons: Schema.optional(Schema.Array(Schema.Unknown)),
	frameworks: Schema.optional(Schema.Array(Schema.Unknown)),
	templates: Schema.optional(Schema.Array(Schema.Unknown)),
	catalog: Schema.Array(RegistryCatalogEntrySchema),
});

export const decodeRegistryPackageManifest = Schema.decodeUnknown(
	RegistryPackageManifestSchema,
);

export type { RegistryDescriptor, RegistryUnit };

export interface LoadedDefinitionRegistry {
	readonly catalog: ReadonlyArray<CatalogEntry>;
	readonly descriptors: ReadonlyArray<RegistryDescriptor>;
	readonly registry: DefinitionRegistry<ForgeConfig>;
}

export interface LoadedAddonDefinition {
	readonly addon: AddonDefinition<ForgeConfig>;
	readonly catalogEntry?: AddonCatalogEntry;
}

export function adapterKey(addon: string, framework: string) {
	return `${addon}\u0000${framework}`;
}

export function frameworkCatalogEntry(
	framework: FrameworkDefinition,
	metadata: FirstPartyFrameworkMetadata,
): FrameworkCatalogEntry {
	return {
		available: true,
		category: "web",
		description: metadata.description,
		docsUrl: metadata.docsUrl,
		experimental: metadata.experimental,
		hidden: metadata.hidden,
		id: metadata.id,
		keywords: metadata.keywords,
		kind: "framework",
		name: metadata.name,
		slots: framework.slots,
		source: "first-party",
		summary: metadata.summary,
	};
}

export function templateCatalogEntry(
	template: TemplateDefinition<ForgeConfig>,
	metadata: FirstPartyTemplateMetadata,
): TemplateCatalogEntry {
	return {
		available: true,
		category: template.category,
		description: metadata.description,
		docsUrl: metadata.docsUrl,
		experimental: metadata.experimental,
		framework: template.framework,
		hidden: metadata.hidden,
		id: metadata.id,
		keywords: metadata.keywords,
		kind: "template",
		name: metadata.name,
		source: "first-party",
		summary: metadata.summary,
		version: template.version,
	};
}

export function addonCatalogEntry(
	addon: AddonDefinition<ForgeConfig>,
	metadata: FirstPartyAddonMetadata,
	adapters: ReadonlyArray<AdapterDefinition<ForgeConfig>>,
	source = "first-party",
	adapterSources: ReadonlyMap<string, string> = new Map(),
): AddonCatalogEntry {
	const addonAdapters = adapters.filter(
		(adapter) => adapter.addon === addon.id,
	);

	const frameworks = deriveAddonFrameworks(addon, adapters);
	const frameworkSources: Record<string, string> = {};
	for (const framework of frameworks ?? [])
		frameworkSources[framework] = addonDeclaresFramework(addon, framework)
			? source
			: (adapterSources.get(adapterKey(addon.id, framework)) ?? source);

	const capabilities = addon.compatibility?.package?.capabilities;
	const requiredSlots = [
		...new Set([
			...addonAdapters.flatMap((adapter) => adapter.requiredSlots),
			...(addon.compatibility?.app?.requiredSlots ?? []),
			...(addon.compatibility?.package?.requiredSlots ?? []),
		]),
	] as ReadonlyArray<ManagedSurfaceName>;

	return {
		available: true,
		capabilities,
		category: addon.category,
		description: metadata.description,
		docsUrl: metadata.docsUrl,
		experimental: metadata.experimental,
		frameworks,
		frameworkSources,
		hidden: metadata.hidden,
		id: metadata.id,
		keywords: metadata.keywords,
		kind: "addon",
		name: metadata.name,
		requiredSlots: requiredSlots.length > 0 ? requiredSlots : undefined,
		source,
		summary: metadata.summary,
		targetMode: addon.targetMode,
	};
}

export function announcedCatalogEntry(
	kind: "framework",
	id: string,
	name: string,
): FrameworkCatalogEntry;
export function announcedCatalogEntry(
	kind: "addon",
	id: string,
	name: string,
	category: string,
): AddonCatalogEntry;
export function announcedCatalogEntry(
	kind: "addon" | "framework",
	id: string,
	name: string,
	category = "web",
): AddonCatalogEntry | FrameworkCatalogEntry {
	const summary = `${name} support is coming soon.`;
	const metadata = {
		available: false,
		category,
		description: summary,
		experimental: false,
		hidden: false,
		id,
		keywords: [],
		name,
		source: "first-party",
		summary,
	};

	if (kind === "framework")
		return {
			...metadata,
			kind,
			slots: [],
		};

	return {
		...metadata,
		frameworkSources: {},
		frameworks: [],
		kind,
		targetMode: "multiple",
	};
}
