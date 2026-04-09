import { intro, isCancel, log, multiselect, select } from "@clack/prompts";
import type { InstallRecord } from "@ryuujs/core";
import {
	builtins,
	getCatalogEntry,
	listVisibleAddons,
} from "@ryuujs/generators";
import { cancel } from "../utils/cancel";
import { applyInstalledPlan, loadManagedProject } from "./lifecycle";

function moduleLabel(
	moduleId: string,
	modules: ReadonlyArray<{
		readonly id: string;
		readonly packageName?: string;
		readonly root: string;
	}>,
) {
	const module = modules.find((entry) => entry.id === moduleId);
	if (!module) return moduleId;

	return module.packageName
		? `${module.packageName} (${module.root})`
		: module.root;
}

function removeTargets(
	record: InstallRecord,
	moduleIds: ReadonlyArray<string>,
): InstallRecord | undefined {
	const targets = record.targets.filter(
		(target) =>
			target.kind !== "module" || !moduleIds.includes(target.moduleId),
	);

	return targets.length > 0 ? { ...record, targets } : undefined;
}

async function promptForInstalledAddonId(
	installs: ReadonlyArray<InstallRecord>,
) {
	const installedIds = new Set(installs.map((entry) => entry.definitionId));
	const installedAddons = listVisibleAddons().filter((entry) =>
		installedIds.has(entry.id),
	);

	if (installedAddons.length === 0) {
		log.error("We couldn't find any installed addons to remove.");
		process.exit(1);
	}

	const selectedAddon = await select({
		message: "Which addon do you want to remove?",
		options: installedAddons.map((entry) => ({
			hint: entry.summary,
			label: entry.name,
			value: entry.id,
		})),
	});

	if (isCancel(selectedAddon)) cancel();
	return String(selectedAddon);
}

export async function runRemove(
	addonId: string | undefined,
	_values: Record<string, string | boolean | undefined>,
) {
	const project = await loadManagedProject(".", "remove");
	const resolvedAddonId =
		addonId ?? (await promptForInstalledAddonId(project.manifest.installs));

	intro(`We're removing "${resolvedAddonId}"...`);

	const catalogEntry = getCatalogEntry(resolvedAddonId);
	const addon = builtins.addons.find(
		(entry) =>
			entry.id ===
			(catalogEntry?.kind === "addon" ? catalogEntry.id : resolvedAddonId),
	);
	const install = project.manifest.installs.find(
		(entry) => entry.definitionId === resolvedAddonId,
	);

	if (!addon || !install) {
		log.error(`We couldn't find "${resolvedAddonId}" in this project.`);
		process.exit(1);
	}

	let nextInstalls = project.manifest.installs;

	if (install.targets.some((target) => target.kind === "project")) {
		nextInstalls = nextInstalls.filter(
			(entry) => entry.definitionId !== resolvedAddonId,
		);
	} else {
		const moduleTargets = install.targets
			.filter((target) => target.kind === "module")
			.map((target) => target.moduleId);

		let selectedModuleIds = moduleTargets;
		if (moduleTargets.length > 1) {
			const result = await multiselect({
				message: `Where should we remove "${addon.name}" from?`,
				options: moduleTargets.map((moduleId) => ({
					label: moduleLabel(moduleId, project.modules),
					value: moduleId,
				})),
				required: true,
			});

			if (isCancel(result)) cancel();
			selectedModuleIds = result.map(String);
		}

		nextInstalls = nextInstalls
			.map((entry) =>
				entry.definitionId === resolvedAddonId
					? removeTargets(entry, selectedModuleIds)
					: entry,
			)
			.filter((entry): entry is InstallRecord => entry !== undefined);
	}

	await applyInstalledPlan(project.projectRoot, project.config, nextInstalls);
}
