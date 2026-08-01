import { intro, isCancel, log, select, text } from "@clack/prompts";
import {
	type AddonDefinition,
	type InstallRecord,
	isAddonCompatibleWithModule,
} from "@ryuujs/core";
import {
	configWithInstall,
	type ForgeConfig,
	getCatalogEntry,
	installConflict,
	listVisibleAddons,
	loadAddonDefinition,
	loadDefinitionRegistry,
	matchQuery,
	orms,
	RegistryLoadError,
} from "@ryuujs/generators";
import { cancel } from "../utils/cancel";
import { applyInstalledPlan, loadManagedProject } from "./lifecycle";

function mergeInstallRecord(
	existing: ReadonlyArray<InstallRecord>,
	record: InstallRecord,
	targetMode: "single" | "multiple",
) {
	if (targetMode === "single")
		return [
			...existing.filter((entry) => entry.definitionId !== record.definitionId),
			record,
		];

	const records = new Map(
		existing.map((entry) => [entry.definitionId, entry.targets]),
	);

	const current = records.get(record.definitionId) ?? [];
	const next = [...current];

	for (const target of record.targets) {
		const key =
			target.kind === "project" ? "project" : `module:${target.moduleId}`;

		if (
			next.some(
				(entry) =>
					(entry.kind === "project"
						? "project"
						: `module:${entry.moduleId}`) === key,
			)
		)
			continue;

		next.push(target);
	}

	records.set(record.definitionId, next);
	return [...records.entries()].map(([definitionId, targets]) => ({
		definitionId,
		targets,
	}));
}

async function promptForAddonId() {
	const visibleAddons = await listVisibleAddons();
	const query = await text({
		message: "Search for an addon (leave blank to browse).",
		placeholder: "tailwind, auth, trpc...",
	});

	if (isCancel(query)) cancel();

	const filtered = visibleAddons.filter(
		(entry) => entry.available && matchQuery(entry, String(query ?? "")),
	);

	if (filtered.length === 0) {
		log.error("We couldn't find an addon matching that search.");
		process.exit(1);
	}

	if (filtered.length === 1) {
		const matchedAddon = filtered[0];
		if (!matchedAddon) {
			log.error("We couldn't find an addon matching that search.");
			process.exit(1);
		}

		return matchedAddon.id;
	}

	const selectedAddon = await select({
		message: "Which addon do you want to add?",
		options: filtered.map((entry) => ({
			hint: entry.summary,
			label: entry.name,
			value: entry.id,
		})),
	});

	if (isCancel(selectedAddon)) cancel();
	return String(selectedAddon);
}

function buildProjectInstallRecord(
	addon: AddonDefinition<ForgeConfig>,
): InstallRecord {
	return { definitionId: addon.id, targets: [{ kind: "project" }] };
}

export async function runAdd(
	addonId: string | undefined,
	_values: Record<string, string | boolean | undefined>,
) {
	const resolvedAddonId = addonId ?? (await promptForAddonId());
	intro(`We're adding "${resolvedAddonId}"...`);

	const project = await loadManagedProject(".", "add");
	let addon: AddonDefinition<ForgeConfig>;

	try {
		const loadedAddon = await loadAddonDefinition(resolvedAddonId);
		addon = loadedAddon.addon;
	} catch (error) {
		if (error instanceof RegistryLoadError) {
			const catalogEntry = getCatalogEntry(resolvedAddonId);
			if (catalogEntry?.kind === "addon" && !catalogEntry.available) {
				log.error(`"${catalogEntry.name}" isn't available yet.`);
				process.exit(1);
			}

			log.error(`We couldn't find the "${resolvedAddonId}" addon.`);
			process.exit(1);
		}

		throw error;
	}

	if (addon.category === "packageManager") {
		log.error("We can't switch package managers yet.");
		process.exit(1);
	}

	if (addon.id === "better-auth" && !orms.normalize(project.config.orm)) {
		log.error("You need to add an ORM before you can use Better Auth.");
		process.exit(1);
	}

	const conflictId = installConflict(
		addon.id,
		project.manifest.installs.map((entry) => entry.definitionId),
	);

	if (conflictId !== undefined) {
		const conflict = loadAddonDefinition(conflictId).addon;
		log.error(`This project already uses ${conflict.name}.`);

		process.exit(1);
	}

	let record: InstallRecord;
	const registry = loadDefinitionRegistry().registry;
	const hasAdapters = registry.adapters.some(
		(adapter) => adapter.addon === addon.id,
	);

	if (addon.compatibility === undefined && !hasAdapters)
		record = buildProjectInstallRecord(addon);
	else {
		const targets = project.modules.filter((module) =>
			isAddonCompatibleWithModule(
				addon,
				module,
				registry.frameworks,
				registry.adapters,
			),
		);

		if (targets.length === 0) {
			const unsupportedApp = hasAdapters
				? project.modules.find(
						(module) =>
							module.type === "app" &&
							!registry.adapters.some(
								(adapter) =>
									adapter.addon === addon.id &&
									adapter.framework === module.framework,
							),
					)
				: undefined;

			const unsupportedFramework =
				unsupportedApp?.type === "app"
					? registry.frameworks.find(
							(framework) => framework.id === unsupportedApp.framework,
						)
					: undefined;

			if (unsupportedApp?.type === "app") {
				const frameworkName =
					unsupportedFramework?.name ??
					unsupportedApp.framework
						.split("-")
						.map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
						.join(" ");

				log.error(`${addon.name} does not support ${frameworkName} yet.`);
				process.exit(1);
			}

			log.error(`We couldn't find a compatible target for "${addon.name}".`);
			process.exit(1);
		}

		if (targets.length === 1 || addon.targetMode === "single") {
			const target = targets[0];
			if (!target) {
				log.error(`We couldn't find a compatible target for "${addon.name}".`);
				process.exit(1);
			}

			record = {
				definitionId: addon.id,
				targets: [{ kind: "module", moduleId: target.id }],
			};
		} else
			record = {
				definitionId: addon.id,
				targets: targets.map((target) => ({
					kind: "module" as const,
					moduleId: target.id,
				})),
			};
	}

	await applyInstalledPlan(
		project.projectRoot,
		configWithInstall(project.config, addon.id),
		mergeInstallRecord(project.manifest.installs, record, addon.targetMode),
	);
}
