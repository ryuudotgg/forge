import {
	confirm,
	intro,
	isCancel,
	log,
	multiselect,
	select,
} from "@clack/prompts";
import {
	type InstallRecord,
	isAddonCompatibleWithModule,
	packageManagerRemoveCommand,
} from "@ryuujs/core";
import {
	type AddonCatalogEntry,
	configWithoutInstall,
	type ForgeConfig,
	findRemovalBlockers,
	type LoadedDefinitionRegistry,
	loadAddonDefinition,
	RegistryLoadError,
} from "@ryuujs/generators";
import { cancel } from "../utils/cancel";
import { listAnd } from "../utils/list";
import {
	applyInstalledPlan,
	configuredPackageManager,
	hasProjectDevDependency,
	loadManagedProject,
	loadProjectRegistry,
	runPackageManagerOperation,
} from "./lifecycle";

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

function descriptorAddonIds(
	descriptor: LoadedDefinitionRegistry["descriptors"][number],
) {
	return descriptor.units.flatMap((unit) =>
		unit.kind === "addon" ? [unit.id] : [],
	);
}

function assertNoRemovalBlockers(
	addon: LoadedDefinitionRegistry["registry"]["addons"][number],
	config: ForgeConfig,
	installs: ReadonlyArray<InstallRecord>,
	project: Awaited<ReturnType<typeof loadManagedProject>>,
	loaded: LoadedDefinitionRegistry,
) {
	const blockers = findRemovalBlockers(
		addon.id,
		config,
		installs.map((entry) => entry.definitionId),
		project.modules.map((module) => module.template),
		loaded.registry,
	);

	const label = addon.category === "orm" ? "the ORM" : addon.name;

	if (blockers.frameworks.length > 0) {
		log.error(
			`We can't remove ${label} because your ${listAnd.format(blockers.frameworks)} app needs it.`,
		);

		process.exit(1);
	}

	if (blockers.dependents.length > 0) {
		const names = listAnd.format(
			blockers.dependents.map((dependent) => dependent.name),
		);

		log.error(`We can't remove ${label} until you remove ${names}.`);
		process.exit(1);
	}
}

function registrySupportsLiveUnits(
	descriptor: LoadedDefinitionRegistry["descriptors"][number],
	installs: ReadonlyArray<InstallRecord>,
	modules: ReadonlyArray<{
		readonly framework?: string;
		readonly id: string;
		readonly template: { readonly id: string };
	}>,
) {
	const installedTargets = new Map(
		installs.map((install) => [install.definitionId, install.targets]),
	);

	return descriptor.units.some((unit) => {
		if (unit.kind === "addon") return installedTargets.has(unit.id);
		if (unit.kind === "framework")
			return modules.some((module) => module.framework === unit.id);

		if (unit.kind === "template")
			return modules.some((module) => module.template.id === unit.id);

		const targets = installedTargets.get(unit.addon) ?? [];
		return targets.some(
			(target) =>
				target.kind === "module" &&
				modules.some(
					(module) =>
						module.id === target.moduleId &&
						module.framework === unit.framework,
				),
		);
	});
}

function retargetAfterDeregistration(
	installs: ReadonlyArray<InstallRecord>,
	loaded: LoadedDefinitionRegistry,
	modules: ReadonlyArray<Parameters<typeof isAddonCompatibleWithModule>[1]>,
): ReadonlyArray<InstallRecord> {
	return installs.map((install) => {
		if (install.targets.some((target) => target.kind === "project"))
			return install;

		const addon = loaded.registry.addons.find(
			(entry) => entry.id === install.definitionId,
		);

		if (addon === undefined) return install;

		const hasAdapters = loaded.registry.adapters.some(
			(adapter) => adapter.addon === addon.id,
		);

		if (addon.compatibility === undefined && !hasAdapters)
			return {
				definitionId: install.definitionId,
				targets: [{ kind: "project" }],
			};

		const compatibleModules = modules.filter((module) =>
			isAddonCompatibleWithModule(
				addon,
				module,
				loaded.registry.frameworks,
				loaded.registry.adapters,
			),
		);

		const compatibleIds = new Set(compatibleModules.map((module) => module.id));
		const retainedTargets = install.targets.filter(
			(target) =>
				target.kind === "module" && compatibleIds.has(target.moduleId),
		);

		if (retainedTargets.length === install.targets.length) return install;
		if (retainedTargets.length > 0)
			return { definitionId: install.definitionId, targets: retainedTargets };

		if (addon.compatibility === undefined)
			return {
				definitionId: install.definitionId,
				targets: [{ kind: "project" }],
			};

		const fallbackModules =
			addon.targetMode === "single"
				? compatibleModules.slice(0, 1)
				: compatibleModules;

		return fallbackModules.length === 0
			? install
			: {
					definitionId: install.definitionId,
					targets: fallbackModules.map(
						(module): InstallRecord["targets"][number] => ({
							kind: "module",
							moduleId: module.id,
						}),
					),
				};
	});
}

async function deregisterPackage(
	project: Awaited<ReturnType<typeof loadManagedProject>>,
	descriptor: LoadedDefinitionRegistry["descriptors"][number],
	nextConfig: ForgeConfig,
	nextInstalls: ReadonlyArray<InstallRecord>,
) {
	const registryIds = (project.manifest.registries ?? []).filter(
		(entry) => entry !== descriptor.id,
	);

	const nextRegistry = await loadProjectRegistry(
		project.projectRoot,
		registryIds,
	);

	const reconciledInstalls = retargetAfterDeregistration(
		nextInstalls,
		nextRegistry,
		project.modules,
	);

	await applyInstalledPlan(
		project.projectRoot,
		nextConfig,
		reconciledInstalls,
		undefined,
		registryIds,
	);

	if (!(await hasProjectDevDependency(project.projectRoot, descriptor.id)))
		return;

	const operation = packageManagerRemoveCommand(
		configuredPackageManager(project.config),
		descriptor.id,
	);

	if (!(await runPackageManagerOperation(project.projectRoot, operation)))
		log.warn(
			`We removed ${descriptor.id} from Forge, but couldn't uninstall its unused devDependency.`,
		);
}

async function promptForInstalledAddonId(
	installs: ReadonlyArray<InstallRecord>,
	loaded: LoadedDefinitionRegistry,
) {
	const installedIds = new Set(installs.map((entry) => entry.definitionId));
	const installedAddons = loaded.catalog.filter(
		(entry): entry is AddonCatalogEntry =>
			entry.kind === "addon" &&
			entry.available &&
			entry.hidden === false &&
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
	const loadedRegistry = await loadProjectRegistry(
		project.projectRoot,
		project.manifest.registries ?? [],
	);

	const resolvedAddonId =
		addonId ??
		(await promptForInstalledAddonId(
			project.manifest.installs,
			loadedRegistry,
		));

	intro(`We're removing "${resolvedAddonId}"...`);
	const directDescriptor = loadedRegistry.descriptors.find(
		(entry) => entry.id === resolvedAddonId,
	);

	if (directDescriptor !== undefined) {
		const stripsLiveSupport = registrySupportsLiveUnits(
			directDescriptor,
			project.manifest.installs,
			project.modules,
		);

		const removeRegistry = await confirm({
			message: stripsLiveSupport
				? `Removing ${directDescriptor.id} will also remove addons or support this project still uses. Do you want to continue?`
				: `Do you want to remove ${directDescriptor.id} from this project?`,
			active: "Yes",
			inactive: "No",
		});

		if (isCancel(removeRegistry)) cancel();
		if (!removeRegistry) return;

		const ownedAddonIds = descriptorAddonIds(directDescriptor);
		const nextInstalls = project.manifest.installs.filter(
			(install) => !ownedAddonIds.includes(install.definitionId),
		);

		const nextConfig = ownedAddonIds.reduce(
			(config, id) => configWithoutInstall(config, id),
			project.config satisfies ForgeConfig,
		);

		for (const ownedAddonId of ownedAddonIds) {
			const ownedAddon = loadedRegistry.registry.addons.find(
				(entry) => entry.id === ownedAddonId,
			);

			if (ownedAddon !== undefined)
				assertNoRemovalBlockers(
					ownedAddon,
					nextConfig,
					nextInstalls,
					project,
					loadedRegistry,
				);
		}

		await deregisterPackage(
			project,
			directDescriptor,
			nextConfig,
			nextInstalls,
		);

		return;
	}

	const install = project.manifest.installs.find(
		(entry) => entry.definitionId === resolvedAddonId,
	);

	if (!install) {
		log.error(`We couldn't find "${resolvedAddonId}" in this project.`);
		process.exit(1);
	}

	const catalogEntry = loadedRegistry.catalog.find(
		(entry) => entry.id === resolvedAddonId && entry.kind === "addon",
	);

	let addon: ReturnType<typeof loadAddonDefinition>["addon"];
	try {
		addon =
			loadedRegistry.registry.addons.find(
				(entry) => entry.id === resolvedAddonId,
			) ?? loadAddonDefinition(catalogEntry?.id ?? resolvedAddonId).addon;
	} catch (error) {
		if (error instanceof RegistryLoadError) {
			log.error(`We couldn't find "${resolvedAddonId}" in this project.`);
			process.exit(1);
		}

		throw error;
	}

	if (addon.category === "packageManager") {
		log.error("We can't remove your package manager setup.");
		process.exit(1);
	}

	let nextInstalls = project.manifest.installs;

	if (install.targets.some((target) => target.kind === "project"))
		nextInstalls = nextInstalls.filter(
			(entry) => entry.definitionId !== resolvedAddonId,
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
				entry.definitionId === resolvedAddonId
					? removeTargets(entry, selectedModuleIds)
					: entry,
			)
			.filter((entry): entry is InstallRecord => entry !== undefined);
	}

	const removedEverywhere = !nextInstalls.some(
		(entry) => entry.definitionId === resolvedAddonId,
	);
	const nextConfig = removedEverywhere
		? configWithoutInstall(project.config, resolvedAddonId)
		: project.config;

	if (removedEverywhere) {
		assertNoRemovalBlockers(
			addon,
			nextConfig,
			nextInstalls,
			project,
			loadedRegistry,
		);
	}

	const registryIds = project.manifest.registries;
	const descriptor = loadedRegistry.descriptors.find((entry) =>
		entry.units.some(
			(unit) => unit.kind === "addon" && unit.id === resolvedAddonId,
		),
	);

	const ownedAddonIds =
		descriptor === undefined ? [] : descriptorAddonIds(descriptor);

	const removedLastRegistryAddon =
		removedEverywhere &&
		descriptor !== undefined &&
		!nextInstalls.some((entry) => ownedAddonIds.includes(entry.definitionId));

	let deregistered = false;
	if (
		removedLastRegistryAddon &&
		descriptor !== undefined &&
		!registrySupportsLiveUnits(descriptor, nextInstalls, project.modules)
	) {
		const removeRegistry = await confirm({
			message: `Do you also want to remove ${descriptor.id} from this project?`,
			active: "Yes",
			inactive: "No",
		});

		if (isCancel(removeRegistry)) cancel();

		if (removeRegistry) {
			await deregisterPackage(
				project,
				descriptor,
				nextConfig satisfies ForgeConfig,
				nextInstalls,
			);

			deregistered = true;
		}
	}

	if (deregistered) return;

	await applyInstalledPlan(
		project.projectRoot,
		nextConfig,
		nextInstalls,
		undefined,
		registryIds,
	);
}
