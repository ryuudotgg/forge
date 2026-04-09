import { intro, isCancel, log, multiselect } from "@clack/prompts";
import type { InstallRecord } from "@ryuujs/core";
import { builtins } from "@ryuujs/generators";
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

export async function runRemove(
	generatorId: string,
	_values: Record<string, string | boolean | undefined>,
) {
	intro(`We're removing "${generatorId}"...`);

	const project = await loadManagedProject(".", "remove");
	const addon = builtins.addons.find((entry) => entry.id === generatorId);
	const install = project.manifest.installs.find(
		(entry) => entry.definitionId === generatorId,
	);

	if (!addon || !install) {
		log.error(`We couldn't find "${generatorId}" in this project.`);
		process.exit(1);
	}

	let nextInstalls = project.manifest.installs;

	if (install.targets.some((target) => target.kind === "project"))
		nextInstalls = nextInstalls.filter(
			(entry) => entry.definitionId !== generatorId,
		);
	else {
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
				entry.definitionId === generatorId
					? removeTargets(entry, selectedModuleIds)
					: entry,
			)
			.filter((entry): entry is InstallRecord => entry !== undefined);
	}

	await applyInstalledPlan(project.projectRoot, project.config, nextInstalls);
}
