import type {
	AddonDefinition,
	CapabilityId,
	DefinitionRegistry,
	FrameworkDefinition,
	FrameworkId,
	ManagedSurfaceName,
	TargetMode,
	TemplateDefinition,
} from "@ryuujs/core";
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
	readonly category: string;
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
	readonly kind: "addon";
	readonly requiredSlots?: ReadonlyArray<ManagedSurfaceName>;
	readonly targetMode: TargetMode;
}

export type CatalogEntry =
	| AddonCatalogEntry
	| FrameworkCatalogEntry
	| TemplateCatalogEntry;

export interface LoadedDefinitionRegistry {
	readonly registry: DefinitionRegistry<ForgeConfig>;
}

export interface LoadedAddonDefinition {
	readonly addon: AddonDefinition<ForgeConfig>;
	readonly catalogEntry?: AddonCatalogEntry;
}

export function frameworkCatalogEntry(
	framework: FrameworkDefinition,
	metadata: FirstPartyFrameworkMetadata,
): FrameworkCatalogEntry {
	return {
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
		summary: metadata.summary,
	};
}

export function templateCatalogEntry(
	template: TemplateDefinition<ForgeConfig>,
	metadata: FirstPartyTemplateMetadata,
): TemplateCatalogEntry {
	return {
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
		summary: metadata.summary,
		version: template.version,
	};
}

export function addonCatalogEntry(
	addon: AddonDefinition<ForgeConfig>,
	metadata: FirstPartyAddonMetadata,
): AddonCatalogEntry {
	const frameworks = addon.compatibility?.app?.frameworks;
	const capabilities = addon.compatibility?.package?.capabilities;
	const requiredSlots = [
		...new Set([
			...(addon.compatibility?.app?.requiredSlots ?? []),
			...(addon.compatibility?.package?.requiredSlots ?? []),
		]),
	] as ReadonlyArray<ManagedSurfaceName>;

	return {
		capabilities,
		category: addon.category,
		description: metadata.description,
		docsUrl: metadata.docsUrl,
		experimental: metadata.experimental,
		frameworks,
		hidden: metadata.hidden,
		id: metadata.id,
		keywords: metadata.keywords,
		kind: "addon",
		name: metadata.name,
		requiredSlots: requiredSlots.length > 0 ? requiredSlots : undefined,
		summary: metadata.summary,
		targetMode: addon.targetMode,
	};
}
