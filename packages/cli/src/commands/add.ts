import { intro, isCancel, log, multiselect, select } from "@clack/prompts";
import { type InstallRecord, isAddonCompatibleWithModule } from "@ryuujs/core";
import { builtins } from "@ryuujs/generators";
import { cancel } from "../utils/cancel";
import { applyInstalledPlan, loadManagedProject } from "./lifecycle";

function moduleLabel(module: {
	readonly packageName?: string;
	readonly root: string;
}) {
	return module.packageName
		? `${module.packageName} (${module.root})`
		: module.root;
}

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

export async function runAdd(
	generatorId: string,
	_values: Record<string, string | boolean | undefined>,
) {
	intro(`We're forging "${generatorId}"...`);

	const project = await loadManagedProject(".", "add");
	const addon = builtins.addons.find((entry) => entry.id === generatorId);

	if (!addon) {
		log.error(`We couldn't find the "${generatorId}" addon.`);
		process.exit(1);
	}

	let record: InstallRecord;

	if (addon.compatibility === undefined)
		record = { definitionId: addon.id, targets: [{ kind: "project" }] };
	else if (addon.targetMode === "single") {
		const targets = project.modules.filter((module) =>
			isAddonCompatibleWithModule(addon, module),
		);

		if (targets.length === 0) {
			log.error(`We couldn't find a compatible target for "${addon.name}".`);
			process.exit(1);
		}

		if (targets.length === 1) {
			const target = targets[0];
			if (!target) {
				log.error(`We couldn't find a compatible target for "${addon.name}".`);
				process.exit(1);
			}

			record = {
				definitionId: addon.id,
				targets: [{ kind: "module", moduleId: target.id }],
			};
		} else {
			const selectedTarget = await select({
				message: `Where should we add "${addon.name}"?`,
				options: targets.map((module) => ({
					label: moduleLabel(module),
					value: module.id,
				})),
			});

			if (isCancel(selectedTarget)) cancel();

			record = {
				definitionId: addon.id,
				targets: [{ kind: "module", moduleId: String(selectedTarget) }],
			};
		}
	} else {
		const targets = project.modules.filter((module) =>
			isAddonCompatibleWithModule(addon, module),
		);

		if (targets.length === 0) {
			log.error(`We couldn't find a compatible target for "${addon.name}".`);
			process.exit(1);
		}

		const selectedTargets = await multiselect({
			message: `Where should we add "${addon.name}"?`,
			options: targets.map((module) => ({
				label: moduleLabel(module),
				value: module.id,
			})),
			required: true,
		});

		if (isCancel(selectedTargets)) cancel();

		record = {
			definitionId: addon.id,
			targets: selectedTargets.map((moduleId) => ({
				kind: "module" as const,
				moduleId: String(moduleId),
			})),
		};
	}

	await applyInstalledPlan(
		project.projectRoot,
		project.config,
		mergeInstallRecord(project.manifest.installs, record, addon.targetMode),
	);
}
