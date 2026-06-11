import {
	type AddonDefinition,
	type DependencyRef,
	resolveDefinitions,
	type TemplateRef,
} from "@ryuujs/core";
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
								(template.id === moduleTemplate.id ||
									template.id.endsWith(`/${moduleTemplate.id}`)) &&
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

export function resolveBuiltins(config: ForgeConfig) {
	return resolveDefinitions(config, firstPartyRegistry);
}
