import { intro, isCancel, log, select, spinner, text } from "@clack/prompts";
import {
	type AddonDefinition,
	addonDeclaresFramework,
	type DiscoveredModule,
	type InstallRecord,
	isAddonCompatibleWithModule,
	packageManagerAddDevCommand,
} from "@ryuujs/core";
import {
	type AddonCatalogEntry,
	configWithInstall,
	type ForgeConfig,
	installConflict,
	type LoadedDefinitionRegistry,
	loadAddonDefinition,
	matchQuery,
	orms,
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
import { resolutionArguments } from "./resolution";

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

function visibleAddons(loaded: LoadedDefinitionRegistry) {
	return loaded.catalog.filter(
		(entry): entry is AddonCatalogEntry =>
			entry.kind === "addon" && entry.available && entry.hidden === false,
	);
}

async function promptForAddonId(loaded: LoadedDefinitionRegistry) {
	const addons = visibleAddons(loaded);
	const query = await text({
		message: "Search for an addon (leave blank to browse).",
		placeholder: "tailwind, auth, trpc...",
	});

	if (isCancel(query)) cancel();

	const filtered = addons.filter(
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

function addonFromRegistry(loaded: LoadedDefinitionRegistry, id: string) {
	return loaded.registry.addons.find((entry) => entry.id === id);
}

function catalogAddon(loaded: LoadedDefinitionRegistry, id: string) {
	const entry = loaded.catalog.find((candidate) => candidate.id === id);
	return entry?.kind === "addon" ? entry : undefined;
}

function scopedPackageId(id: string) {
	return /^@[^/@\s]+\/[^/@\s]+$/.test(id);
}

function barePackageIdFromVersionedId(id: string) {
	const separator = id.lastIndexOf("@");
	if (separator <= id.indexOf("/")) return undefined;

	const barePackageId = id.slice(0, separator);
	return scopedPackageId(barePackageId) && id.slice(separator + 1).length > 0
		? barePackageId
		: undefined;
}

function titleFromId(id: string) {
	return (
		id
			.split("/")
			.at(-1)
			?.split("-")
			.map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
			.join(" ") ?? id
	);
}

function packageAddonIds(loaded: LoadedDefinitionRegistry, registryId: string) {
	return (
		loaded.descriptors
			.find((descriptor) => descriptor.id === registryId)
			?.units.flatMap((unit) => (unit.kind === "addon" ? [unit.id] : [])) ?? []
	);
}

type RegisteredAddonSuggestion =
	| { readonly kind: "none" }
	| { readonly addonId: string; readonly kind: "single" }
	| {
			readonly choices: ReadonlyArray<{
				readonly hint?: string;
				readonly id: string;
				readonly name: string;
			}>;
			readonly kind: "multiple";
	  };

function suggestRegisteredAddon(
	loaded: LoadedDefinitionRegistry,
	registryId: string,
): RegisteredAddonSuggestion {
	const addonIds = packageAddonIds(loaded, registryId);
	const [addonId, ...remainingAddonIds] = addonIds;
	if (addonId === undefined) return { kind: "none" };
	if (remainingAddonIds.length === 0) return { addonId, kind: "single" };

	return {
		choices: addonIds.flatMap((id) => {
			const addon = addonFromRegistry(loaded, id);
			if (addon === undefined) return [];

			const metadata = catalogAddon(loaded, id);
			return [
				{
					...(metadata === undefined ? {} : { hint: metadata.summary }),
					id,
					name: metadata?.name ?? addon.name,
				},
			];
		}),
		kind: "multiple",
	};
}

function announceAdapterSupport(
	loaded: LoadedDefinitionRegistry,
	registryId: string,
) {
	const descriptor = loaded.descriptors.find(
		(entry) => entry.id === registryId,
	);

	if (descriptor === undefined) return 0;

	const supportByAddon = new Map<
		string,
		{ readonly frameworks: Set<string>; readonly name: string }
	>();

	for (const unit of descriptor.units) {
		if (unit.kind !== "adapter") continue;

		const addonName =
			loaded.registry.addons.find((entry) => entry.id === unit.addon)?.name ??
			titleFromId(unit.addon);
		const frameworkName =
			loaded.registry.frameworks.find((entry) => entry.id === unit.framework)
				?.name ?? titleFromId(unit.framework);
		const support = supportByAddon.get(unit.addon) ?? {
			frameworks: new Set<string>(),
			name: addonName,
		};
		support.frameworks.add(frameworkName);
		supportByAddon.set(unit.addon, support);
	}

	for (const support of supportByAddon.values())
		log.success(
			`${support.name} now supports ${listAnd.format(support.frameworks)}.`,
		);

	return supportByAddon.size;
}

function retargetAdapterInstalls(
	installs: ReadonlyArray<InstallRecord>,
	config: ForgeConfig,
	before: LoadedDefinitionRegistry,
	after: LoadedDefinitionRegistry,
	registryId: string,
	modules: ReadonlyArray<DiscoveredModule>,
): ReadonlyArray<InstallRecord> {
	const adapterAddonIds = new Set(
		after.descriptors
			.find((entry) => entry.id === registryId)
			?.units.flatMap((unit) =>
				unit.kind === "adapter" ? [unit.addon] : [],
			) ?? [],
	);

	return installs.map((install) => {
		if (!adapterAddonIds.has(install.definitionId)) return install;

		const addon = addonFromRegistry(after, install.definitionId);
		if (addon === undefined) return install;

		const compatibleBefore = modules.filter(
			(module) =>
				(addon.target?.(config, module) ?? true) &&
				isAddonCompatibleWithModule(
					addon,
					module,
					before.registry.frameworks,
					before.registry.adapters,
				),
		);

		const compatibleAfter = modules.filter(
			(module) =>
				(addon.target?.(config, module) ?? true) &&
				isAddonCompatibleWithModule(
					addon,
					module,
					after.registry.frameworks,
					after.registry.adapters,
				),
		);

		if (compatibleAfter.length === 0) return install;

		const compatibleAfterIds = new Set(
			compatibleAfter.map((module) => module.id),
		);

		const compatibleBeforeIds = new Set(
			compatibleBefore.map((module) => module.id),
		);

		const currentModuleIds = install.targets.flatMap((target) =>
			target.kind === "module" ? [target.moduleId] : [],
		);

		const retainedIds = currentModuleIds.filter((id) =>
			compatibleAfterIds.has(id),
		);

		if (addon.targetMode === "single") {
			const targetId = retainedIds[0] ?? compatibleAfter[0]?.id;
			return targetId === undefined
				? install
				: {
						definitionId: install.definitionId,
						targets: [
							{
								kind: "module",
								moduleId: targetId,
							},
						],
					};
		}

		const targetIds = install.targets.some(
			(target) => target.kind === "project",
		)
			? compatibleAfter.map((module) => module.id)
			: [
					...retainedIds,
					...compatibleAfter
						.filter((module) => !compatibleBeforeIds.has(module.id))
						.map((module) => module.id),
				];

		const uniqueTargetIds = [...new Set(targetIds)];

		return {
			definitionId: install.definitionId,
			targets: uniqueTargetIds.map(
				(moduleId): InstallRecord["targets"][number] => ({
					kind: "module",
					moduleId,
				}),
			),
		};
	});
}

async function selectRegistryAddon(
	loaded: LoadedDefinitionRegistry,
	registryId: string,
) {
	const suggestion = suggestRegisteredAddon(loaded, registryId);
	if (suggestion.kind === "none") return undefined;
	if (suggestion.kind === "single") return suggestion.addonId;

	const selected = await select({
		message: "Which addon do you want to add?",
		options: suggestion.choices.map((entry) => ({
			...(entry.hint === undefined ? {} : { hint: entry.hint }),
			label: entry.name,
			value: entry.id,
		})),
	});

	if (isCancel(selected)) cancel();

	return String(selected);
}

async function installRegistryPackage(
	projectRoot: string,
	config: ForgeConfig,
	registryId: string,
	noInstall: boolean,
) {
	if (await hasProjectDevDependency(projectRoot, registryId)) return true;

	const operation = packageManagerAddDevCommand(
		configuredPackageManager(config),
		registryId,
	);

	const manualCommand = [operation.command, ...operation.args].join(" ");

	if (noInstall) {
		log.error(
			`We can't add ${registryId} without installing it. Run "${manualCommand}" inside the project, then try again.`,
		);

		process.exit(1);
	}

	const progress = spinner();
	progress.start(`We're installing ${registryId}...`);

	const installed = await runPackageManagerOperation(projectRoot, operation);
	if (!installed) {
		progress.stop(`We couldn't install ${registryId}.`);
		log.warn(
			`The install didn't finish, so run "${manualCommand}" yourself inside the project, then try again.`,
		);

		process.exit(1);
	}

	progress.stop(`We've installed ${registryId}!`);
	return true;
}

function buildProjectInstallRecord(
	addon: AddonDefinition<ForgeConfig>,
): InstallRecord {
	return { definitionId: addon.id, targets: [{ kind: "project" }] };
}

export async function runAdd(
	addonId: string | undefined,
	values: Record<string, string | boolean | undefined>,
) {
	const resolution = resolutionArguments(values);
	const project = await loadManagedProject(".", "add");

	let registryIds = project.manifest.registries;
	let loadedRegistry = await loadProjectRegistry(
		project.projectRoot,
		registryIds ?? [],
	);

	let resolvedAddonId = addonId ?? (await promptForAddonId(loadedRegistry));

	const barePackageId = barePackageIdFromVersionedId(resolvedAddonId);
	if (barePackageId !== undefined) {
		log.error(
			`We can't add "${resolvedAddonId}" with a version. Pass the bare package name "${barePackageId}" instead.`,
		);

		process.exit(1);
	}

	intro(`We're adding "${resolvedAddonId}"...`);

	let baseInstalls = project.manifest.installs;
	let registeredRegistry: { readonly id: string } | undefined;

	const existingDescriptor = loadedRegistry.descriptors.find(
		(entry) => entry.id === resolvedAddonId,
	);

	if (existingDescriptor !== undefined) {
		const selectedAddonId = await selectRegistryAddon(
			loadedRegistry,
			resolvedAddonId,
		);

		if (selectedAddonId === undefined) {
			log.warn(`${resolvedAddonId} is already part of this project.`);
			return;
		}

		resolvedAddonId = selectedAddonId;
	}

	if (
		catalogAddon(loadedRegistry, resolvedAddonId) === undefined &&
		addonFromRegistry(loadedRegistry, resolvedAddonId) === undefined &&
		scopedPackageId(resolvedAddonId)
	) {
		const registryId = resolvedAddonId;
		await installRegistryPackage(
			project.projectRoot,
			project.config satisfies ForgeConfig,
			registryId,
			values["no-install"] === true,
		);

		const previousRegistry = loadedRegistry;

		registryIds = [...(registryIds ?? []), registryId];
		loadedRegistry = await loadProjectRegistry(
			project.projectRoot,
			registryIds,
		);

		registeredRegistry = { id: registryId };
		baseInstalls = retargetAdapterInstalls(
			project.manifest.installs,
			project.config satisfies ForgeConfig,
			previousRegistry,
			loadedRegistry,
			registryId,
			project.modules,
		);

		const selectedAddonId = await selectRegistryAddon(
			loadedRegistry,
			registryId,
		);

		if (selectedAddonId === undefined) {
			await applyInstalledPlan(
				project.projectRoot,
				project.config,
				baseInstalls,
				undefined,
				registryIds,
				...resolution,
			);

			if (announceAdapterSupport(loadedRegistry, registryId) === 0)
				log.warn(
					`${registryId} doesn't provide anything this project can use yet.`,
				);

			return;
		}

		resolvedAddonId = selectedAddonId;
	}

	const requestedCatalogEntry = loadedRegistry.catalog.find(
		(entry) => entry.id === resolvedAddonId,
	);

	if (
		requestedCatalogEntry?.kind === "framework" &&
		requestedCatalogEntry.category === "backend"
	) {
		log.error("We can't add a backend framework to an existing project yet.");
		process.exit(1);
	}

	let addon: AddonDefinition<ForgeConfig>;
	try {
		addon =
			addonFromRegistry(loadedRegistry, resolvedAddonId) ??
			loadAddonDefinition(resolvedAddonId).addon;
	} catch (error) {
		if (error instanceof RegistryLoadError) {
			const catalogEntry = catalogAddon(loadedRegistry, resolvedAddonId);
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
		const conflict =
			addonFromRegistry(loadedRegistry, conflictId) ??
			loadAddonDefinition(conflictId).addon;

		log.error(`This project already uses ${conflict.name}.`);
		process.exit(1);
	}

	const registry = loadedRegistry.registry;
	const hasAdapters = registry.adapters.some(
		(adapter) => adapter.addon === addon.id,
	);

	let record: InstallRecord;
	if (addon.compatibility === undefined && !hasAdapters)
		record = buildProjectInstallRecord(addon);
	else {
		const targets = project.modules.filter(
			(module) =>
				(addon.target?.(project.config satisfies ForgeConfig, module) ??
					true) &&
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
							!addonDeclaresFramework(addon, module.framework) &&
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
				targets: targets.map((target): InstallRecord["targets"][number] => ({
					kind: "module",
					moduleId: target.id,
				})),
			};
	}

	const nextConfig = configWithInstall(project.config, addon.id);
	const nextInstalls = mergeInstallRecord(
		baseInstalls,
		record,
		addon.targetMode,
	);

	await applyInstalledPlan(
		project.projectRoot,
		nextConfig,
		nextInstalls,
		undefined,
		registryIds,
		...resolution,
	);

	if (registeredRegistry !== undefined)
		announceAdapterSupport(loadedRegistry, registeredRegistry.id);
}
