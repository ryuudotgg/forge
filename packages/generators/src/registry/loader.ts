import { resolveDefinitions } from "@ryuujs/core";
import type { ForgeConfig } from "../config";
import { firstPartyCatalog, firstPartyRegistry } from "./first-party";
import type {
	AddonCatalogEntry,
	CatalogEntry,
	LoadedAddonDefinition,
	LoadedDefinitionRegistry,
} from "./types";

export class RegistryLoadError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "RegistryLoadError";
	}
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
			entry.kind === "addon" && entry.hidden === false,
	);
}

export function loadAddonDefinition(id: string): LoadedAddonDefinition {
	const addon = firstPartyRegistry.addons.find((entry) => entry.id === id);
	if (!addon) throw new RegistryLoadError(`Addon Not Found: ${id}`);

	return {
		addon,
		catalogEntry: firstPartyCatalog.find(
			(entry): entry is AddonCatalogEntry =>
				entry.kind === "addon" && entry.id === id,
		),
	};
}

export function loadDefinitionRegistry(): LoadedDefinitionRegistry {
	return {
		registry: firstPartyRegistry,
	};
}

export function resolveBuiltins(config: ForgeConfig) {
	return resolveDefinitions(config, firstPartyRegistry);
}
