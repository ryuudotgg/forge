import { defineAdapter, defineAddon } from "@ryuujs/core";
import {
	type ForgeConfig,
	type LoadedDefinitionRegistry,
	loadDefinitionRegistry,
	type RegistryUnit,
} from "@ryuujs/generators";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { runRemove } from "../src/commands/remove";
import {
	adminModule,
	appModule,
	managedProject,
	reactRouterModule,
} from "./lifecycle-fixtures";

function addonRegistryFixture(
	units?: (addonId: string) => ReadonlyArray<RegistryUnit>,
) {
	const firstParty = loadDefinitionRegistry();
	const addon = defineAddon<ForgeConfig>({
		id: "@acme/sentry",
		name: "Sentry",
		version: "1.0.0",
		category: "tooling",
		exclusive: false,
		targetMode: "multiple",
		when: () => false,
		contribute: () => [],
	});
	const loaded: LoadedDefinitionRegistry = {
		catalog: [
			...firstParty.catalog,
			{
				available: true,
				category: "tooling",
				description: "Sentry observability.",
				experimental: false,
				frameworkSources: {},
				hidden: false,
				id: addon.id,
				keywords: ["sentry"],
				kind: "addon",
				name: addon.name,
				source: "@acme/forge-sentry",
				summary: "Add Sentry.",
				targetMode: addon.targetMode,
			},
		],
		descriptors: [
			{
				apiVersion: 1,
				id: "@acme/forge-sentry",
				source: "npm",
				units: units?.(addon.id) ?? [{ id: addon.id, kind: "addon" }],
				version: "1.4.2",
			},
		],
		registry: {
			...firstParty.registry,
			addons: [...firstParty.registry.addons, addon],
		},
	};
	return { addon, firstParty, loaded };
}

const liveModuleUnits: ReadonlyArray<readonly [string, RegistryUnit]> = [
	["framework", { id: "nextjs", kind: "framework" }],
	["template", { id: "nextjs/base", kind: "template" }],
];

const promptMocks = vi.hoisted(() => ({
	confirm: vi.fn(),
	intro: vi.fn(),
	logError: vi.fn(),
	logWarn: vi.fn(),
	multiselect: vi.fn(),
	select: vi.fn(),
	text: vi.fn(),
}));

const lifecycleMocks = vi.hoisted(() => ({
	applyInstalledPlan: vi.fn(),
	configuredPackageManager: vi.fn(),
	hasProjectDevDependency: vi.fn(),
	loadManagedProject: vi.fn(),
	loadProjectRegistry: vi.fn(),
	runPackageManagerOperation: vi.fn(),
}));

vi.mock("@clack/prompts", () => ({
	confirm: promptMocks.confirm,
	intro: promptMocks.intro,
	isCancel: () => false,
	log: { error: promptMocks.logError, warn: promptMocks.logWarn },
	multiselect: promptMocks.multiselect,
	select: promptMocks.select,
	text: promptMocks.text,
}));

vi.mock("../src/commands/lifecycle", () => ({
	applyInstalledPlan: lifecycleMocks.applyInstalledPlan,
	configuredPackageManager: lifecycleMocks.configuredPackageManager,
	hasProjectDevDependency: lifecycleMocks.hasProjectDevDependency,
	loadManagedProject: lifecycleMocks.loadManagedProject,
	loadProjectRegistry: lifecycleMocks.loadProjectRegistry,
	runPackageManagerOperation: lifecycleMocks.runPackageManagerOperation,
}));

describe("remove command", () => {
	beforeEach(() => {
		lifecycleMocks.applyInstalledPlan.mockReset();
		lifecycleMocks.configuredPackageManager.mockReset();
		lifecycleMocks.hasProjectDevDependency.mockReset();
		lifecycleMocks.loadManagedProject.mockReset();
		lifecycleMocks.loadProjectRegistry.mockReset();
		lifecycleMocks.runPackageManagerOperation.mockReset();
		promptMocks.confirm.mockReset();
		promptMocks.intro.mockReset();
		promptMocks.logError.mockReset();
		promptMocks.logWarn.mockReset();
		promptMocks.multiselect.mockReset();
		promptMocks.select.mockReset();
		promptMocks.text.mockReset();
		lifecycleMocks.hasProjectDevDependency.mockResolvedValue(false);
		lifecycleMocks.configuredPackageManager.mockImplementation(
			(config: { readonly packageManager?: unknown }) =>
				["pnpm", "npm", "Yarn", "Bun"].includes(String(config.packageManager))
					? config.packageManager
					: "pnpm",
		);
		lifecycleMocks.loadProjectRegistry.mockResolvedValue(
			loadDefinitionRegistry(),
		);
		lifecycleMocks.runPackageManagerOperation.mockResolvedValue(true);
	});

	it("offers to remove a registry after its last installed addon", async () => {
		const firstParty = loadDefinitionRegistry();
		const addon = defineAddon<ForgeConfig>({
			id: "@acme/sentry",
			name: "Sentry",
			version: "1.0.0",
			category: "tooling",
			exclusive: false,
			targetMode: "multiple",
			when: () => false,
			contribute: () => [],
		});
		const loaded: LoadedDefinitionRegistry = {
			catalog: [
				...firstParty.catalog,
				{
					available: true,
					category: "tooling",
					description: "Sentry observability.",
					experimental: false,
					frameworkSources: {},
					hidden: false,
					id: "@acme/sentry",
					keywords: ["sentry"],
					kind: "addon",
					name: "Sentry",
					source: "@acme/forge-sentry",
					summary: "Add Sentry.",
					targetMode: "multiple",
				},
			],
			descriptors: [
				{
					apiVersion: 1,
					id: "@acme/forge-sentry",
					source: "npm",
					units: [{ id: "@acme/sentry", kind: "addon" }],
					version: "1.4.2",
				},
			],
			registry: {
				...firstParty.registry,
				addons: [...firstParty.registry.addons, addon],
			},
		};
		lifecycleMocks.loadManagedProject.mockResolvedValue(
			managedProject({
				config: { packageManager: "pnpm", slug: "acme" },
				installs: [
					{
						definitionId: "@acme/sentry",
						targets: [{ kind: "project" }],
					},
				],
				registries: ["@acme/forge-sentry"],
				registryDescriptors: loaded.descriptors,
			}),
		);
		lifecycleMocks.loadProjectRegistry.mockResolvedValue(loaded);
		lifecycleMocks.hasProjectDevDependency.mockResolvedValue(true);
		promptMocks.confirm.mockResolvedValue(true);

		await runRemove("@acme/sentry", {});

		expect(promptMocks.confirm).toHaveBeenCalledWith({
			message:
				"Do you also want to remove @acme/forge-sentry from this project?",
			active: "Yes",
			inactive: "No",
		});
		expect(lifecycleMocks.runPackageManagerOperation).toHaveBeenCalledWith(
			".",
			{
				args: ["remove", "@acme/forge-sentry"],
				command: "pnpm",
			},
		);
		expect(lifecycleMocks.applyInstalledPlan).toHaveBeenCalledWith(
			".",
			{ packageManager: "pnpm", slug: "acme" },
			[],
			undefined,
			[],
		);
	});

	it("does not uninstall a registry when planning its deregistration fails", async () => {
		const { addon, firstParty, loaded } = addonRegistryFixture();
		lifecycleMocks.loadManagedProject.mockResolvedValue(
			managedProject({
				config: { packageManager: "pnpm", slug: "acme" },
				installs: [{ definitionId: addon.id, targets: [{ kind: "project" }] }],
				registries: ["@acme/forge-sentry"],
			}),
		);
		lifecycleMocks.loadProjectRegistry
			.mockResolvedValueOnce(loaded)
			.mockResolvedValueOnce(firstParty);
		lifecycleMocks.hasProjectDevDependency.mockResolvedValue(true);
		lifecycleMocks.applyInstalledPlan.mockRejectedValue(
			new Error("Merge Refused"),
		);
		promptMocks.confirm.mockResolvedValue(true);

		await expect(runRemove(addon.id, {})).rejects.toThrow("Merge Refused");

		expect(lifecycleMocks.runPackageManagerOperation).not.toHaveBeenCalled();
		expect(lifecycleMocks.loadProjectRegistry).toHaveBeenNthCalledWith(
			2,
			".",
			[],
		);
	});

	it("keeps a deregistered manifest when package removal fails", async () => {
		const { addon, firstParty, loaded } = addonRegistryFixture();
		lifecycleMocks.loadManagedProject.mockResolvedValue(
			managedProject({
				config: { packageManager: "pnpm", slug: "acme" },
				installs: [{ definitionId: addon.id, targets: [{ kind: "project" }] }],
				registries: ["@acme/forge-sentry"],
			}),
		);
		lifecycleMocks.loadProjectRegistry
			.mockResolvedValueOnce(loaded)
			.mockResolvedValueOnce(firstParty);
		lifecycleMocks.hasProjectDevDependency.mockResolvedValue(true);
		lifecycleMocks.runPackageManagerOperation.mockResolvedValue(false);
		promptMocks.confirm.mockResolvedValue(true);

		await runRemove(addon.id, {});

		expect(lifecycleMocks.applyInstalledPlan).toHaveBeenCalledWith(
			".",
			{ packageManager: "pnpm", slug: "acme" },
			[],
			undefined,
			[],
		);
		expect(
			lifecycleMocks.applyInstalledPlan.mock.invocationCallOrder[0],
		).toBeLessThan(
			lifecycleMocks.runPackageManagerOperation.mock.invocationCallOrder[0] ??
				0,
		);
		expect(promptMocks.logWarn).toHaveBeenCalledWith(
			"We removed @acme/forge-sentry from Forge, but couldn't uninstall its unused devDependency.",
		);
	});

	it("directly removes an adapter-only registry and restores a project target", async () => {
		const firstParty = loadDefinitionRegistry();
		const adapter = defineAdapter<ForgeConfig>({
			addon: "vitest",
			framework: "nextjs",
			contribute: () => [],
		});
		const loaded: LoadedDefinitionRegistry = {
			catalog: firstParty.catalog,
			descriptors: [
				{
					apiVersion: 1,
					id: "@acme/forge-vitest",
					source: "npm",
					units: [{ addon: "vitest", framework: "nextjs", kind: "adapter" }],
					version: "1.0.0",
				},
			],
			registry: {
				...firstParty.registry,
				adapters: [...firstParty.registry.adapters, adapter],
			},
		};
		lifecycleMocks.loadManagedProject.mockResolvedValue(
			managedProject({
				installs: [
					{
						definitionId: "vitest",
						targets: [{ kind: "module", moduleId: appModule.id }],
					},
				],
				registries: ["@acme/forge-vitest"],
			}),
		);
		lifecycleMocks.loadProjectRegistry
			.mockResolvedValueOnce(loaded)
			.mockResolvedValueOnce(firstParty);
		promptMocks.confirm.mockResolvedValue(true);

		await runRemove("@acme/forge-vitest", {});

		expect(promptMocks.confirm).toHaveBeenCalledWith({
			message:
				"Removing @acme/forge-vitest will also remove addons or support this project still uses. Do you want to continue?",
			active: "Yes",
			inactive: "No",
		});
		expect(lifecycleMocks.applyInstalledPlan).toHaveBeenCalledWith(
			".",
			{ slug: "acme", web: "nextjs" },
			[{ definitionId: "vitest", targets: [{ kind: "project" }] }],
			undefined,
			[],
		);
	});

	it("reconciles surviving addon targets after direct registry removal", async () => {
		const firstParty = loadDefinitionRegistry();
		const retainedAddon = defineAddon<ForgeConfig>({
			id: "@acme/retained",
			name: "Retained",
			version: "1.0.0",
			category: "tooling",
			exclusive: false,
			targetMode: "multiple",
			compatibility: { app: { frameworks: ["nextjs"] } },
			when: () => false,
			contribute: () => [],
		});
		const partialAddon = defineAddon<ForgeConfig>({
			...retainedAddon,
			id: "@acme/partial",
			name: "Partial",
		});
		const adapterOnlyAddon = defineAddon<ForgeConfig>({
			id: "@acme/adapter-only",
			name: "Adapter Only",
			version: "1.0.0",
			category: "tooling",
			exclusive: false,
			targetMode: "multiple",
			when: () => false,
			contribute: () => [],
		});
		const singleAddon = defineAddon<ForgeConfig>({
			...retainedAddon,
			id: "@acme/single",
			name: "Single",
			targetMode: "single",
		});
		const nextRegistry: LoadedDefinitionRegistry = {
			catalog: firstParty.catalog,
			descriptors: [],
			registry: {
				...firstParty.registry,
				adapters: [
					...firstParty.registry.adapters,
					defineAdapter<ForgeConfig>({
						addon: adapterOnlyAddon.id,
						framework: "nextjs",
						contribute: () => [],
					}),
				],
				addons: [
					...firstParty.registry.addons,
					retainedAddon,
					partialAddon,
					adapterOnlyAddon,
					singleAddon,
				],
			},
		};
		const descriptor: LoadedDefinitionRegistry["descriptors"][number] = {
			apiVersion: 1,
			id: "@acme/forge-empty",
			source: "npm",
			units: [],
			version: "1.0.0",
		};
		const loaded: LoadedDefinitionRegistry = {
			...nextRegistry,
			descriptors: [descriptor],
		};
		lifecycleMocks.loadManagedProject.mockResolvedValue(
			managedProject({
				installs: [
					{ definitionId: "tailwind", targets: [{ kind: "project" }] },
					{
						definitionId: retainedAddon.id,
						targets: [{ kind: "module", moduleId: appModule.id }],
					},
					{
						definitionId: partialAddon.id,
						targets: [
							{ kind: "module", moduleId: appModule.id },
							{ kind: "module", moduleId: reactRouterModule.id },
						],
					},
					{
						definitionId: adapterOnlyAddon.id,
						targets: [{ kind: "module", moduleId: reactRouterModule.id }],
					},
					{
						definitionId: singleAddon.id,
						targets: [{ kind: "module", moduleId: "uvwxy" }],
					},
				],
				modules: [appModule, adminModule, reactRouterModule],
				registries: [descriptor.id],
			}),
		);
		lifecycleMocks.loadProjectRegistry
			.mockResolvedValueOnce(loaded)
			.mockResolvedValueOnce(nextRegistry);
		promptMocks.confirm.mockResolvedValue(true);

		await runRemove(descriptor.id, {});

		expect(lifecycleMocks.applyInstalledPlan).toHaveBeenCalledWith(
			".",
			{ slug: "acme", web: "nextjs" },
			[
				{ definitionId: "tailwind", targets: [{ kind: "project" }] },
				{
					definitionId: retainedAddon.id,
					targets: [{ kind: "module", moduleId: appModule.id }],
				},
				{
					definitionId: partialAddon.id,
					targets: [{ kind: "module", moduleId: appModule.id }],
				},
				{
					definitionId: adapterOnlyAddon.id,
					targets: [{ kind: "project" }],
				},
				{
					definitionId: singleAddon.id,
					targets: [{ kind: "module", moduleId: appModule.id }],
				},
			],
			undefined,
			[],
		);
	});

	it("directly removes every addon owned by a registry", async () => {
		const { addon, firstParty, loaded } = addonRegistryFixture();
		lifecycleMocks.loadManagedProject.mockResolvedValue(
			managedProject({
				installs: [{ definitionId: addon.id, targets: [{ kind: "project" }] }],
				registries: ["@acme/forge-sentry"],
			}),
		);
		lifecycleMocks.loadProjectRegistry
			.mockResolvedValueOnce(loaded)
			.mockResolvedValueOnce(firstParty);
		promptMocks.confirm.mockResolvedValue(true);

		await runRemove("@acme/forge-sentry", {});

		expect(lifecycleMocks.applyInstalledPlan).toHaveBeenCalledWith(
			".",
			{ slug: "acme", web: "nextjs" },
			[],
			undefined,
			[],
		);
	});

	it("reports addon blockers before directly removing their registry", async () => {
		const { addon, loaded } = addonRegistryFixture();
		const dependent = defineAddon<ForgeConfig>({
			id: "@acme/replay",
			name: "Replay",
			version: "1.0.0",
			category: "tooling",
			dependencies: [{ id: addon.id, type: "addon" }],
			exclusive: false,
			targetMode: "multiple",
			when: () => true,
			contribute: () => [],
		});
		const loadedWithDependent: LoadedDefinitionRegistry = {
			...loaded,
			registry: {
				...loaded.registry,
				addons: [...loaded.registry.addons, dependent],
			},
		};
		lifecycleMocks.loadManagedProject.mockResolvedValue(
			managedProject({
				installs: [
					{ definitionId: addon.id, targets: [{ kind: "project" }] },
					{ definitionId: dependent.id, targets: [{ kind: "project" }] },
				],
				registries: ["@acme/forge-sentry"],
			}),
		);
		lifecycleMocks.loadProjectRegistry.mockResolvedValue(loadedWithDependent);
		promptMocks.confirm.mockResolvedValue(true);
		const exit = vi.spyOn(process, "exit").mockImplementation((code) => {
			throw new Error(`exit:${code ?? 0}`);
		});

		try {
			await expect(runRemove("@acme/forge-sentry", {})).rejects.toThrow(
				"exit:1",
			);

			expect(promptMocks.logError).toHaveBeenCalledWith(
				"We can't remove Sentry until you remove Replay.",
			);
			expect(lifecycleMocks.loadProjectRegistry).toHaveBeenCalledTimes(1);
			expect(lifecycleMocks.applyInstalledPlan).not.toHaveBeenCalled();
		} finally {
			exit.mockRestore();
		}
	});

	it("does not offer deregistration while another addon uses its adapter", async () => {
		const { addon, loaded } = addonRegistryFixture((addonId) => [
			{ id: addonId, kind: "addon" },
			{ addon: "vitest", framework: "nextjs", kind: "adapter" },
		]);
		lifecycleMocks.loadManagedProject.mockResolvedValue(
			managedProject({
				installs: [
					{ definitionId: addon.id, targets: [{ kind: "project" }] },
					{
						definitionId: "vitest",
						targets: [{ kind: "module", moduleId: appModule.id }],
					},
				],
				registries: ["@acme/forge-sentry"],
			}),
		);
		lifecycleMocks.loadProjectRegistry.mockResolvedValue(loaded);

		await runRemove(addon.id, {});

		expect(promptMocks.confirm).not.toHaveBeenCalled();
		expect(lifecycleMocks.applyInstalledPlan).toHaveBeenCalledWith(
			".",
			{ slug: "acme", web: "nextjs" },
			[
				{
					definitionId: "vitest",
					targets: [{ kind: "module", moduleId: appModule.id }],
				},
			],
			undefined,
			["@acme/forge-sentry"],
		);
	});

	it.each(liveModuleUnits)(
		"does not offer deregistration while a module uses its %s",
		async (_kind, liveUnit) => {
			const { addon, loaded } = addonRegistryFixture((addonId) => [
				{ id: addonId, kind: "addon" },
				liveUnit,
			]);
			lifecycleMocks.loadManagedProject.mockResolvedValue(
				managedProject({
					installs: [
						{ definitionId: addon.id, targets: [{ kind: "project" }] },
					],
					registries: ["@acme/forge-sentry"],
				}),
			);
			lifecycleMocks.loadProjectRegistry.mockResolvedValue(loaded);

			await runRemove(addon.id, {});

			expect(promptMocks.confirm).not.toHaveBeenCalled();
			expect(lifecycleMocks.applyInstalledPlan).toHaveBeenCalledWith(
				".",
				{ slug: "acme", web: "nextjs" },
				[],
				undefined,
				["@acme/forge-sentry"],
			);
		},
	);

	it("prompts from installed addons when called without an id", async () => {
		lifecycleMocks.loadManagedProject.mockResolvedValue(
			managedProject({
				installs: [
					{
						definitionId: "tailwind",
						targets: [{ kind: "module", moduleId: "abcde" }],
					},
				],
			}),
		);

		promptMocks.select.mockResolvedValue("tailwind");

		await runRemove(undefined, {});

		expect(lifecycleMocks.loadManagedProject).toHaveBeenCalledWith(
			".",
			"remove",
		);
		expect(promptMocks.select).toHaveBeenCalledWith({
			message: "Which addon do you want to remove?",
			options: [
				{
					hint: "Add Tailwind CSS support.",
					label: "Tailwind CSS",
					value: "tailwind",
				},
			],
		});
		expect(promptMocks.multiselect).not.toHaveBeenCalled();
		expect(lifecycleMocks.applyInstalledPlan).toHaveBeenCalledWith(
			".",
			{ slug: "acme", web: "nextjs" },
			[],
			undefined,
			undefined,
		);
	});

	it("forwards registries and conflict policy when removing an addon", async () => {
		lifecycleMocks.loadManagedProject.mockResolvedValue(
			managedProject({
				installs: [
					{ definitionId: "tailwind", targets: [{ kind: "project" }] },
				],
				registries: ["@acme/forge-sentry"],
			}),
		);

		await runRemove("tailwind", { "accept-forge": true });

		expect(lifecycleMocks.applyInstalledPlan).toHaveBeenCalledWith(
			".",
			{ slug: "acme", web: "nextjs" },
			[],
			undefined,
			["@acme/forge-sentry"],
			{ resolutionPolicy: "accept-forge" },
		);
	});

	it("drops opt-in addons from the config when fully removed", async () => {
		lifecycleMocks.loadManagedProject.mockResolvedValue(
			managedProject({
				config: { addons: ["commitlint", "lefthook"], slug: "acme" },
				installs: [
					{ definitionId: "commitlint", targets: [{ kind: "project" }] },
					{ definitionId: "lefthook", targets: [{ kind: "project" }] },
				],
			}),
		);

		await runRemove("commitlint", {});

		expect(promptMocks.multiselect).not.toHaveBeenCalled();
		expect(lifecycleMocks.applyInstalledPlan).toHaveBeenCalledWith(
			".",
			{ addons: ["lefthook"], slug: "acme" },
			[{ definitionId: "lefthook", targets: [{ kind: "project" }] }],
			undefined,
			undefined,
		);
	});

	it("prompts for module targets only when an addon is installed in multiple modules", async () => {
		lifecycleMocks.loadManagedProject.mockResolvedValue(
			managedProject({
				config: { slug: "acme", style: "tailwind", web: "nextjs" },
				installs: [
					{
						definitionId: "tailwind",
						targets: [
							{ kind: "module", moduleId: "abcde" },
							{ kind: "module", moduleId: "fghij" },
						],
					},
				],
				modules: [appModule, adminModule],
			}),
		);

		promptMocks.multiselect.mockResolvedValue(["abcde"]);

		await runRemove("tailwind", {});

		expect(promptMocks.multiselect).toHaveBeenCalledWith({
			message: 'Where should we remove "Tailwind CSS" from?',
			options: [
				{ label: "@acme/web (apps/web)", value: "abcde" },
				{ label: "@acme/admin (apps/admin)", value: "fghij" },
			],
			required: true,
		});
		expect(lifecycleMocks.applyInstalledPlan).toHaveBeenCalledWith(
			".",
			{ slug: "acme", style: "tailwind", web: "nextjs" },
			[
				{
					definitionId: "tailwind",
					targets: [{ kind: "module", moduleId: "fghij" }],
				},
			],
			undefined,
			undefined,
		);
	});

	it("clears the mapped config field when removing an orm", async () => {
		lifecycleMocks.loadManagedProject.mockResolvedValue(
			managedProject({
				config: { orm: "drizzle", slug: "acme", web: "nextjs" },
				installs: [{ definitionId: "drizzle", targets: [{ kind: "project" }] }],
			}),
		);

		await runRemove("drizzle", {});

		expect(lifecycleMocks.applyInstalledPlan).toHaveBeenCalledWith(
			".",
			{ slug: "acme", web: "nextjs" },
			[],
			undefined,
			undefined,
		);
	});

	it("refuses to remove the orm while better-auth depends on it", async () => {
		const exit = vi.spyOn(process, "exit").mockImplementation(((
			code?: string | number | null,
		) => {
			throw new Error(`exit:${code ?? 0}`);
		}) as never);

		try {
			lifecycleMocks.loadManagedProject.mockResolvedValue(
				managedProject({
					config: {
						authentication: "better-auth",
						orm: "drizzle",
						slug: "acme",
						web: "nextjs",
					},
					installs: [
						{ definitionId: "better-auth", targets: [{ kind: "project" }] },
						{ definitionId: "drizzle", targets: [{ kind: "project" }] },
					],
				}),
			);

			await expect(runRemove("drizzle", {})).rejects.toThrow("exit:1");

			expect(promptMocks.logError).toHaveBeenCalledWith(
				"We can't remove the ORM until you remove Better Auth.",
			);
			expect(lifecycleMocks.applyInstalledPlan).not.toHaveBeenCalled();
		} finally {
			exit.mockRestore();
		}
	});

	it("refuses to remove addons the app template depends on", async () => {
		const exit = vi.spyOn(process, "exit").mockImplementation(((
			code?: string | number | null,
		) => {
			throw new Error(`exit:${code ?? 0}`);
		}) as never);

		try {
			lifecycleMocks.loadManagedProject.mockResolvedValue(
				managedProject({
					installs: [{ definitionId: "ui", targets: [{ kind: "project" }] }],
				}),
			);

			await expect(runRemove("ui", {})).rejects.toThrow("exit:1");

			expect(promptMocks.logError).toHaveBeenCalledWith(
				"We can't remove UI Package because your Next.js app needs it.",
			);
			expect(lifecycleMocks.applyInstalledPlan).not.toHaveBeenCalled();
		} finally {
			exit.mockRestore();
		}
	});

	it("refuses to remove the package manager setup", async () => {
		const exit = vi.spyOn(process, "exit").mockImplementation(((
			code?: string | number | null,
		) => {
			throw new Error(`exit:${code ?? 0}`);
		}) as never);

		try {
			lifecycleMocks.loadManagedProject.mockResolvedValue(
				managedProject({
					installs: [{ definitionId: "pnpm", targets: [{ kind: "project" }] }],
				}),
			);

			await expect(runRemove("pnpm", {})).rejects.toThrow("exit:1");

			expect(promptMocks.logError).toHaveBeenCalledWith(
				"We can't remove your package manager setup.",
			);
			expect(lifecycleMocks.applyInstalledPlan).not.toHaveBeenCalled();
		} finally {
			exit.mockRestore();
		}
	});

	it("removes better-auth while the orm stays installed", async () => {
		lifecycleMocks.loadManagedProject.mockResolvedValue(
			managedProject({
				config: {
					authentication: "better-auth",
					orm: "prisma",
					slug: "acme",
					web: "nextjs",
				},
				installs: [
					{ definitionId: "better-auth", targets: [{ kind: "project" }] },
					{ definitionId: "prisma", targets: [{ kind: "project" }] },
				],
			}),
		);

		await runRemove("better-auth", {});

		expect(lifecycleMocks.applyInstalledPlan).toHaveBeenCalledWith(
			".",
			{ orm: "prisma", slug: "acme", web: "nextjs" },
			[{ definitionId: "prisma", targets: [{ kind: "project" }] }],
			undefined,
			undefined,
		);
	});

	it("shows a friendly error when an installed addon id is no longer known", async () => {
		const exit = vi.spyOn(process, "exit").mockImplementation(((
			code?: string | number | null,
		) => {
			throw new Error(`exit:${code ?? 0}`);
		}) as never);

		try {
			lifecycleMocks.loadManagedProject.mockResolvedValue(
				managedProject({
					installs: [
						{
							definitionId: "stale",
							targets: [{ kind: "module", moduleId: "abcde" }],
						},
					],
				}),
			);

			await expect(runRemove("stale", {})).rejects.toThrow("exit:1");

			expect(promptMocks.logError).toHaveBeenCalledWith(
				'We couldn\'t find "stale" in this project.',
			);
			expect(lifecycleMocks.applyInstalledPlan).not.toHaveBeenCalled();
		} finally {
			exit.mockRestore();
		}
	});

	it("shows a friendly error when a known addon is not installed", async () => {
		const exit = vi.spyOn(process, "exit").mockImplementation(((
			code?: string | number | null,
		) => {
			throw new Error(`exit:${code ?? 0}`);
		}) as never);

		try {
			lifecycleMocks.loadManagedProject.mockResolvedValue(managedProject());

			await expect(runRemove("tailwind", {})).rejects.toThrow("exit:1");

			expect(promptMocks.logError).toHaveBeenCalledWith(
				'We couldn\'t find "tailwind" in this project.',
			);
			expect(lifecycleMocks.applyInstalledPlan).not.toHaveBeenCalled();
		} finally {
			exit.mockRestore();
		}
	});
});
