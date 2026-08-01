import {
	type AdapterDefinition,
	type AddonDefinition,
	type DiscoveredModule,
	defineAdapter,
	defineAddon,
} from "@ryuujs/core";
import {
	type ForgeConfig,
	type LoadedDefinitionRegistry,
	listVisibleAddons,
	loadDefinitionRegistry,
	type RegistryUnit,
} from "@ryuujs/generators";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { runAdd } from "../src/commands/add";
import {
	adminModule,
	appModule,
	managedProject,
	packageModule,
	reactRouterModule,
} from "./lifecycle-fixtures";

function registryFixture(options: {
	readonly adapters?: ReadonlyArray<AdapterDefinition<ForgeConfig>>;
	readonly addons?: ReadonlyArray<AddonDefinition<ForgeConfig>>;
	readonly base?: LoadedDefinitionRegistry;
	readonly id: string;
	readonly units: ReadonlyArray<RegistryUnit>;
}): LoadedDefinitionRegistry {
	const base = options.base ?? loadDefinitionRegistry();
	const addons = options.addons ?? [];

	return {
		catalog: [
			...base.catalog,
			...addons.map((addon): LoadedDefinitionRegistry["catalog"][number] => ({
				available: true,
				category: addon.category,
				description: `${addon.name} fixture.`,
				experimental: false,
				hidden: false,
				id: addon.id,
				keywords: [addon.name.toLowerCase()],
				kind: "addon",
				name: addon.name,
				summary: `Add ${addon.name}.`,
				targetMode: addon.targetMode,
			})),
		],
		descriptors: [
			...base.descriptors,
			{
				apiVersion: 1,
				id: options.id,
				source: "npm",
				units: options.units,
				version: "1.0.0",
			},
		],
		registry: {
			...base.registry,
			adapters: [...base.registry.adapters, ...(options.adapters ?? [])],
			addons: [...base.registry.addons, ...addons],
		},
	};
}

const packageManagerCommands: ReadonlyArray<
	readonly [ForgeConfig["packageManager"], string, ReadonlyArray<string>]
> = [
	["pnpm", "pnpm", ["add", "-D", "-w", "@acme/forge-empty"]],
	["npm", "npm", ["install", "-D", "@acme/forge-empty"]],
	["Yarn", "yarn", ["add", "-D", "@acme/forge-empty"]],
	["Bun", "bun", ["add", "-d", "@acme/forge-empty"]],
];

const promptMocks = vi.hoisted(() => ({
	cancel: vi.fn(),
	intro: vi.fn(),
	isCancel: vi.fn((_value: unknown) => false),
	logError: vi.fn(),
	logSuccess: vi.fn(),
	logWarn: vi.fn(),
	multiselect: vi.fn(),
	select: vi.fn(),
	spinner: vi.fn(),
	spinnerStart: vi.fn(),
	spinnerStop: vi.fn(),
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
	cancel: promptMocks.cancel,
	intro: promptMocks.intro,
	isCancel: promptMocks.isCancel,
	log: {
		error: promptMocks.logError,
		success: promptMocks.logSuccess,
		warn: promptMocks.logWarn,
	},
	multiselect: promptMocks.multiselect,
	select: promptMocks.select,
	spinner: promptMocks.spinner,
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

vi.mock("@ryuujs/generators", async (importOriginal) => {
	const original = await importOriginal<typeof import("@ryuujs/generators")>();
	const { multiTargetAddon, singleTargetAddon } = await import(
		"./lifecycle-fixtures"
	);

	return {
		...original,
		loadAddonDefinition: (id: string) => {
			if (id === singleTargetAddon.id) return { addon: singleTargetAddon };
			if (id === multiTargetAddon.id) return { addon: multiTargetAddon };
			if (id === "mock-broken")
				throw new Error("Registry Offline: mock-broken");

			return original.loadAddonDefinition(id);
		},
	};
});

describe("add command", () => {
	beforeEach(() => {
		lifecycleMocks.applyInstalledPlan.mockReset();
		lifecycleMocks.configuredPackageManager.mockReset();
		lifecycleMocks.hasProjectDevDependency.mockReset();
		lifecycleMocks.loadManagedProject.mockReset();
		lifecycleMocks.loadProjectRegistry.mockReset();
		lifecycleMocks.runPackageManagerOperation.mockReset();
		promptMocks.cancel.mockReset();
		promptMocks.intro.mockReset();
		promptMocks.isCancel.mockReset();
		promptMocks.logError.mockReset();
		promptMocks.logSuccess.mockReset();
		promptMocks.logWarn.mockReset();
		promptMocks.multiselect.mockReset();
		promptMocks.select.mockReset();
		promptMocks.spinner.mockReset();
		promptMocks.spinnerStart.mockReset();
		promptMocks.spinnerStop.mockReset();
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
		promptMocks.spinner.mockImplementation(() => ({
			start: promptMocks.spinnerStart,
			stop: promptMocks.spinnerStop,
		}));
	});

	it("installs, registers, reloads, and adds a single-addon registry", async () => {
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
		const firstParty = loadDefinitionRegistry();
		lifecycleMocks.loadManagedProject.mockResolvedValue(
			managedProject({
				config: {
					packageManager: "pnpm",
					slug: "acme",
					web: "nextjs",
				},
			}),
		);
		lifecycleMocks.loadProjectRegistry
			.mockResolvedValueOnce(firstParty)
			.mockResolvedValueOnce({
				catalog: [
					...firstParty.catalog,
					{
						available: true,
						category: "tooling",
						description: "Sentry observability.",
						experimental: false,
						hidden: false,
						id: "@acme/sentry",
						keywords: ["sentry"],
						kind: "addon",
						name: "Sentry",
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
			});

		await runAdd("@acme/forge-sentry", {});

		expect(lifecycleMocks.runPackageManagerOperation).toHaveBeenCalledWith(
			".",
			{
				args: ["add", "-D", "-w", "@acme/forge-sentry"],
				command: "pnpm",
			},
		);
		expect(lifecycleMocks.loadProjectRegistry).toHaveBeenLastCalledWith(".", [
			"@acme/forge-sentry",
		]);
		expect(lifecycleMocks.applyInstalledPlan).toHaveBeenCalledWith(
			".",
			{
				packageManager: "pnpm",
				slug: "acme",
				web: "nextjs",
			},
			[
				{
					definitionId: "@acme/sentry",
					targets: [{ kind: "project" }],
				},
			],
			undefined,
			["@acme/forge-sentry"],
		);
		expect(promptMocks.spinnerStart).toHaveBeenCalledWith(
			"We're installing @acme/forge-sentry...",
		);
		expect(promptMocks.spinnerStop).toHaveBeenCalledWith(
			"We've installed @acme/forge-sentry!",
		);
	});

	it.each(packageManagerCommands)(
		"uses the exact %s command for a Forge-driven registry install",
		async (packageManager, command, args) => {
			const before = loadDefinitionRegistry();
			const after = registryFixture({
				base: before,
				id: "@acme/forge-empty",
				units: [],
			});
			lifecycleMocks.loadManagedProject.mockResolvedValue(
				managedProject({ config: { packageManager, slug: "acme" } }),
			);
			lifecycleMocks.loadProjectRegistry
				.mockResolvedValueOnce(before)
				.mockResolvedValueOnce(after);

			await runAdd("@acme/forge-empty", {});

			expect(lifecycleMocks.runPackageManagerOperation).toHaveBeenCalledWith(
				".",
				{ args, command },
			);
		},
	);

	it("scopes the addon picker to a multi-addon registry package", async () => {
		const firstParty = loadDefinitionRegistry();
		const addons = [
			defineAddon<ForgeConfig>({
				id: "@acme/sentry",
				name: "Sentry",
				version: "1.0.0",
				category: "tooling",
				exclusive: false,
				targetMode: "multiple",
				when: () => false,
				contribute: () => [],
			}),
			defineAddon<ForgeConfig>({
				id: "@acme/replay",
				name: "Replay",
				version: "1.0.0",
				category: "tooling",
				exclusive: false,
				targetMode: "multiple",
				when: () => false,
				contribute: () => [],
			}),
		];
		const catalogEntries = addons.map(
			(addon): LoadedDefinitionRegistry["catalog"][number] => ({
				available: true,
				category: "tooling",
				description: `${addon.name} observability.`,
				experimental: false,
				hidden: false,
				id: addon.id,
				keywords: [addon.name.toLowerCase()],
				kind: "addon",
				name: addon.name,
				summary: `Add ${addon.name}.`,
				targetMode: "multiple",
			}),
		);
		lifecycleMocks.loadManagedProject.mockResolvedValue(managedProject());
		lifecycleMocks.loadProjectRegistry
			.mockResolvedValueOnce(firstParty)
			.mockResolvedValueOnce({
				catalog: [...firstParty.catalog, ...catalogEntries],
				descriptors: [
					{
						apiVersion: 1,
						id: "@acme/forge-sentry",
						source: "npm",
						units: addons.map((addon) => ({
							id: addon.id,
							kind: "addon",
						})),
						version: "1.4.2",
					},
				],
				registry: {
					...firstParty.registry,
					addons: [...firstParty.registry.addons, ...addons],
				},
			});
		promptMocks.select.mockResolvedValue("@acme/replay");

		await runAdd("@acme/forge-sentry", {});

		expect(promptMocks.select).toHaveBeenCalledWith({
			message: "Which addon do you want to add?",
			options: catalogEntries.map((entry) => ({
				hint: entry.summary,
				label: entry.name,
				value: entry.id,
			})),
		});
		expect(lifecycleMocks.applyInstalledPlan).toHaveBeenCalledWith(
			".",
			{ slug: "acme", web: "nextjs" },
			[
				{
					definitionId: "@acme/replay",
					targets: [{ kind: "project" }],
				},
			],
			undefined,
			["@acme/forge-sentry"],
		);
	});

	it("registers an adapter-only package and announces newly derived support", async () => {
		const tanstackModule: DiscoveredModule = {
			framework: "tanstack-start",
			id: "abcde",
			packageName: "@acme/web",
			root: "apps/web",
			slots: {
				auth: "app/api/auth/[...all]/route.ts",
				layout: "app/layout.tsx",
				trpc: "app/api/trpc/[trpc]/route.ts",
			},
			template: { id: "tanstack-start/base", version: 1 },
			type: "app",
		};
		const sentry = defineAddon<ForgeConfig>({
			id: "@acme/sentry",
			name: "Sentry",
			version: "1.0.0",
			category: "tooling",
			exclusive: false,
			targetMode: "single",
			when: () => false,
			contribute: () => [],
		});
		const adapter = defineAdapter<ForgeConfig>({
			addon: "@acme/sentry",
			framework: "tanstack-start",
			contribute: () => [],
		});
		const firstParty = loadDefinitionRegistry();
		const before: LoadedDefinitionRegistry = {
			catalog: firstParty.catalog,
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
				addons: [...firstParty.registry.addons, sentry],
			},
		};
		const after: LoadedDefinitionRegistry = {
			...before,
			descriptors: [
				...before.descriptors,
				{
					apiVersion: 1,
					id: "@acme/forge-sentry-tanstack",
					source: "npm",
					units: [
						{
							addon: "@acme/sentry",
							framework: "tanstack-start",
							kind: "adapter",
						},
					],
					version: "1.0.0",
				},
			],
			registry: {
				...before.registry,
				adapters: [...before.registry.adapters, adapter],
			},
		};
		lifecycleMocks.loadManagedProject.mockResolvedValue(
			managedProject({
				config: { slug: "acme", web: "tanstack-start" },
				installs: [
					{
						definitionId: "@acme/sentry",
						targets: [{ kind: "project" }],
					},
				],
				modules: [tanstackModule],
				registries: ["@acme/forge-sentry"],
			}),
		);
		lifecycleMocks.loadProjectRegistry
			.mockResolvedValueOnce(before)
			.mockResolvedValueOnce(after);

		await runAdd("@acme/forge-sentry-tanstack", {});

		expect(lifecycleMocks.applyInstalledPlan).toHaveBeenCalledWith(
			".",
			{ slug: "acme", web: "tanstack-start" },
			[
				{
					definitionId: "@acme/sentry",
					targets: [{ kind: "module", moduleId: "abcde" }],
				},
			],
			undefined,
			["@acme/forge-sentry", "@acme/forge-sentry-tanstack"],
		);
		expect(promptMocks.logSuccess).toHaveBeenCalledWith(
			"Sentry now supports TanStack Start.",
		);
	});

	it("exits cleanly when re-adding an adapter-only registered package", async () => {
		const loaded = registryFixture({
			id: "@acme/forge-adapter",
			units: [{ addon: "vitest", framework: "nextjs", kind: "adapter" }],
		});
		lifecycleMocks.loadManagedProject.mockResolvedValue(
			managedProject({ registries: ["@acme/forge-adapter"] }),
		);
		lifecycleMocks.loadProjectRegistry.mockResolvedValue(loaded);

		await runAdd("@acme/forge-adapter", {});

		expect(promptMocks.logWarn).toHaveBeenCalledWith(
			"@acme/forge-adapter is already part of this project.",
		);
		expect(lifecycleMocks.runPackageManagerOperation).not.toHaveBeenCalled();
		expect(lifecycleMocks.applyInstalledPlan).not.toHaveBeenCalled();
	});

	it("shows the scoped picker when re-adding a multi-addon package", async () => {
		const sentry = defineAddon<ForgeConfig>({
			id: "@acme/sentry",
			name: "Sentry",
			version: "1.0.0",
			category: "tooling",
			exclusive: false,
			targetMode: "multiple",
			when: () => false,
			contribute: () => [],
		});
		const replay = defineAddon<ForgeConfig>({
			...sentry,
			id: "@acme/replay",
			name: "Replay",
		});
		const loaded = registryFixture({
			addons: [sentry, replay],
			id: "@acme/forge-observability",
			units: [
				{ id: sentry.id, kind: "addon" },
				{ id: replay.id, kind: "addon" },
			],
		});
		lifecycleMocks.loadManagedProject.mockResolvedValue(
			managedProject({ registries: ["@acme/forge-observability"] }),
		);
		lifecycleMocks.loadProjectRegistry.mockResolvedValue(loaded);
		promptMocks.select.mockResolvedValue(replay.id);

		await runAdd("@acme/forge-observability", {});

		expect(promptMocks.select).toHaveBeenCalledWith({
			message: "Which addon do you want to add?",
			options: [sentry, replay].map((addon) => ({
				hint: `Add ${addon.name}.`,
				label: addon.name,
				value: addon.id,
			})),
		});
		expect(lifecycleMocks.runPackageManagerOperation).not.toHaveBeenCalled();
	});

	it("includes uncataloged addons when re-adding a registry package", async () => {
		const cataloged = defineAddon<ForgeConfig>({
			id: "@acme/sentry",
			name: "Sentry",
			version: "1.0.0",
			category: "tooling",
			exclusive: false,
			targetMode: "multiple",
			when: () => false,
			contribute: () => [],
		});
		const uncataloged = defineAddon<ForgeConfig>({
			...cataloged,
			id: "@acme/x",
			name: "X",
		});
		const fixture = registryFixture({
			addons: [cataloged, uncataloged],
			id: "@acme/forge-observability",
			units: [
				{ id: cataloged.id, kind: "addon" },
				{ id: uncataloged.id, kind: "addon" },
			],
		});
		const loaded: LoadedDefinitionRegistry = {
			...fixture,
			catalog: fixture.catalog.filter((entry) => entry.id !== uncataloged.id),
		};
		lifecycleMocks.loadManagedProject.mockResolvedValue(
			managedProject({ registries: ["@acme/forge-observability"] }),
		);
		lifecycleMocks.loadProjectRegistry.mockResolvedValue(loaded);
		promptMocks.select.mockResolvedValue(uncataloged.id);

		await runAdd("@acme/forge-observability", {});

		expect(promptMocks.select).toHaveBeenCalledWith({
			message: "Which addon do you want to add?",
			options: [
				{
					hint: `Add ${cataloged.name}.`,
					label: cataloged.name,
					value: cataloged.id,
				},
				{ label: uncataloged.name, value: uncataloged.id },
			],
		});
		expect(lifecycleMocks.runPackageManagerOperation).not.toHaveBeenCalled();
		expect(lifecycleMocks.applyInstalledPlan).toHaveBeenCalledWith(
			".",
			{ slug: "acme", web: "nextjs" },
			[
				{
					definitionId: uncataloged.id,
					targets: [{ kind: "project" }],
				},
			],
			undefined,
			["@acme/forge-observability"],
		);
	});

	it("keeps narrowed multiple targets and adds only newly compatible modules", async () => {
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
		const nextAdapter = defineAdapter<ForgeConfig>({
			addon: addon.id,
			framework: "nextjs",
			contribute: () => [],
		});
		const routerAdapter = defineAdapter<ForgeConfig>({
			addon: addon.id,
			framework: "react-router",
			contribute: () => [],
		});
		const before = registryFixture({
			adapters: [nextAdapter],
			addons: [addon],
			id: "@acme/forge-sentry",
			units: [{ id: addon.id, kind: "addon" }],
		});
		const after = registryFixture({
			adapters: [routerAdapter],
			base: before,
			id: "@acme/forge-sentry-router",
			units: [{ addon: addon.id, framework: "react-router", kind: "adapter" }],
		});
		lifecycleMocks.loadManagedProject.mockResolvedValue(
			managedProject({
				installs: [
					{
						definitionId: addon.id,
						targets: [{ kind: "module", moduleId: adminModule.id }],
					},
				],
				modules: [appModule, adminModule, reactRouterModule],
				registries: ["@acme/forge-sentry"],
			}),
		);
		lifecycleMocks.loadProjectRegistry
			.mockResolvedValueOnce(before)
			.mockResolvedValueOnce(after);

		await runAdd("@acme/forge-sentry-router", {});

		expect(lifecycleMocks.applyInstalledPlan).toHaveBeenCalledWith(
			".",
			{ slug: "acme", web: "nextjs" },
			[
				{
					definitionId: addon.id,
					targets: [
						{ kind: "module", moduleId: adminModule.id },
						{ kind: "module", moduleId: reactRouterModule.id },
					],
				},
			],
			undefined,
			["@acme/forge-sentry", "@acme/forge-sentry-router"],
		);
	});

	it("does not move a single-target install that remains compatible", async () => {
		const addon = defineAddon<ForgeConfig>({
			id: "@acme/single",
			name: "Single",
			version: "1.0.0",
			category: "tooling",
			exclusive: false,
			targetMode: "single",
			when: () => false,
			contribute: () => [],
		});
		const nextAdapter = defineAdapter<ForgeConfig>({
			addon: addon.id,
			framework: "nextjs",
			contribute: () => [],
		});
		const routerAdapter = defineAdapter<ForgeConfig>({
			addon: addon.id,
			framework: "react-router",
			contribute: () => [],
		});
		const before = registryFixture({
			adapters: [nextAdapter],
			addons: [addon],
			id: "@acme/forge-single",
			units: [{ id: addon.id, kind: "addon" }],
		});
		const after = registryFixture({
			adapters: [routerAdapter],
			base: before,
			id: "@acme/forge-single-router",
			units: [{ addon: addon.id, framework: "react-router", kind: "adapter" }],
		});
		lifecycleMocks.loadManagedProject.mockResolvedValue(
			managedProject({
				installs: [
					{
						definitionId: addon.id,
						targets: [{ kind: "module", moduleId: adminModule.id }],
					},
				],
				modules: [appModule, adminModule, reactRouterModule],
				registries: ["@acme/forge-single"],
			}),
		);
		lifecycleMocks.loadProjectRegistry
			.mockResolvedValueOnce(before)
			.mockResolvedValueOnce(after);

		await runAdd("@acme/forge-single-router", {});

		expect(lifecycleMocks.applyInstalledPlan).toHaveBeenCalledWith(
			".",
			{ slug: "acme", web: "nextjs" },
			[
				{
					definitionId: addon.id,
					targets: [{ kind: "module", moduleId: adminModule.id }],
				},
			],
			undefined,
			["@acme/forge-single", "@acme/forge-single-router"],
		);
	});

	it("retargets existing support and adds a mixed package addon in one plan", async () => {
		const sentry = defineAddon<ForgeConfig>({
			id: "@acme/sentry",
			name: "Sentry",
			version: "1.0.0",
			category: "tooling",
			exclusive: false,
			targetMode: "single",
			when: () => false,
			contribute: () => [],
		});
		const replay = defineAddon<ForgeConfig>({
			...sentry,
			id: "@acme/replay",
			name: "Replay",
			targetMode: "multiple",
		});
		const adapter = defineAdapter<ForgeConfig>({
			addon: sentry.id,
			framework: "nextjs",
			contribute: () => [],
		});
		const before = registryFixture({
			addons: [sentry],
			id: "@acme/forge-sentry",
			units: [{ id: sentry.id, kind: "addon" }],
		});
		const after = registryFixture({
			adapters: [adapter],
			addons: [replay],
			base: before,
			id: "@acme/forge-mixed",
			units: [
				{ addon: sentry.id, framework: "nextjs", kind: "adapter" },
				{ id: replay.id, kind: "addon" },
			],
		});
		lifecycleMocks.loadManagedProject.mockResolvedValue(
			managedProject({
				installs: [{ definitionId: sentry.id, targets: [{ kind: "project" }] }],
				registries: ["@acme/forge-sentry"],
			}),
		);
		lifecycleMocks.loadProjectRegistry
			.mockResolvedValueOnce(before)
			.mockResolvedValueOnce(after);

		await runAdd("@acme/forge-mixed", {});

		expect(lifecycleMocks.applyInstalledPlan).toHaveBeenCalledWith(
			".",
			{ slug: "acme", web: "nextjs" },
			[
				{
					definitionId: sentry.id,
					targets: [{ kind: "module", moduleId: appModule.id }],
				},
				{ definitionId: replay.id, targets: [{ kind: "project" }] },
			],
			undefined,
			["@acme/forge-sentry", "@acme/forge-mixed"],
		);
		expect(promptMocks.logSuccess).toHaveBeenCalledWith(
			"Sentry now supports Next.js.",
		);
	});

	it("warns when a newly registered package has zero units", async () => {
		const before = loadDefinitionRegistry();
		const after = registryFixture({
			base: before,
			id: "@acme/forge-empty",
			units: [],
		});
		lifecycleMocks.loadManagedProject.mockResolvedValue(managedProject());
		lifecycleMocks.loadProjectRegistry
			.mockResolvedValueOnce(before)
			.mockResolvedValueOnce(after);

		await runAdd("@acme/forge-empty", {});

		expect(promptMocks.logWarn).toHaveBeenCalledWith(
			"@acme/forge-empty doesn't provide anything this project can use yet.",
		);
	});

	it("groups newly supported frameworks by addon", async () => {
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
		const before = registryFixture({
			addons: [addon],
			id: "@acme/forge-sentry",
			units: [{ id: addon.id, kind: "addon" }],
		});
		const adapters = ["nextjs", "react-router"].map((framework) =>
			defineAdapter<ForgeConfig>({
				addon: addon.id,
				framework,
				contribute: () => [],
			}),
		);
		const after = registryFixture({
			adapters,
			base: before,
			id: "@acme/forge-sentry-web",
			units: adapters.map((adapter) => ({
				addon: adapter.addon,
				framework: adapter.framework,
				kind: "adapter",
			})),
		});
		lifecycleMocks.loadManagedProject.mockResolvedValue(
			managedProject({
				installs: [{ definitionId: addon.id, targets: [{ kind: "project" }] }],
				modules: [appModule, reactRouterModule],
				registries: ["@acme/forge-sentry"],
			}),
		);
		lifecycleMocks.loadProjectRegistry
			.mockResolvedValueOnce(before)
			.mockResolvedValueOnce(after);

		await runAdd("@acme/forge-sentry-web", {});

		expect(promptMocks.logSuccess).toHaveBeenCalledTimes(1);
		expect(promptMocks.logSuccess).toHaveBeenCalledWith(
			"Sentry now supports Next.js and React Router.",
		);
	});

	it("keeps support announcements separate for addons with the same name", async () => {
		const nextAddon = defineAddon<ForgeConfig>({
			id: "@acme/sentry-next",
			name: "Sentry",
			version: "1.0.0",
			category: "tooling",
			exclusive: false,
			targetMode: "multiple",
			when: () => false,
			contribute: () => [],
		});
		const routerAddon = defineAddon<ForgeConfig>({
			...nextAddon,
			id: "@acme/sentry-router",
		});
		const before = registryFixture({
			addons: [nextAddon, routerAddon],
			id: "@acme/forge-sentry",
			units: [
				{ id: nextAddon.id, kind: "addon" },
				{ id: routerAddon.id, kind: "addon" },
			],
		});
		const adapters = [
			defineAdapter<ForgeConfig>({
				addon: nextAddon.id,
				framework: "nextjs",
				contribute: () => [],
			}),
			defineAdapter<ForgeConfig>({
				addon: routerAddon.id,
				framework: "react-router",
				contribute: () => [],
			}),
		];
		const after = registryFixture({
			adapters,
			base: before,
			id: "@acme/forge-sentry-web",
			units: adapters.map((adapter) => ({
				addon: adapter.addon,
				framework: adapter.framework,
				kind: "adapter",
			})),
		});
		lifecycleMocks.loadManagedProject.mockResolvedValue(
			managedProject({
				installs: [
					{ definitionId: nextAddon.id, targets: [{ kind: "project" }] },
					{ definitionId: routerAddon.id, targets: [{ kind: "project" }] },
				],
				modules: [appModule, reactRouterModule],
				registries: ["@acme/forge-sentry"],
			}),
		);
		lifecycleMocks.loadProjectRegistry
			.mockResolvedValueOnce(before)
			.mockResolvedValueOnce(after);

		await runAdd("@acme/forge-sentry-web", {});

		expect(promptMocks.logSuccess).toHaveBeenCalledTimes(2);
		expect(promptMocks.logSuccess).toHaveBeenNthCalledWith(
			1,
			"Sentry now supports Next.js.",
		);
		expect(promptMocks.logSuccess).toHaveBeenNthCalledWith(
			2,
			"Sentry now supports React Router.",
		);
		expect(promptMocks.logWarn).not.toHaveBeenCalled();
	});

	it("adds an uncataloged addon from an installed registry", async () => {
		const addon = defineAddon<ForgeConfig>({
			id: "@acme/x",
			name: "X",
			version: "1.0.0",
			category: "tooling",
			exclusive: false,
			targetMode: "multiple",
			when: () => false,
			contribute: () => [],
		});
		const fixture = registryFixture({
			addons: [addon],
			id: "@acme/forge-x",
			units: [{ id: addon.id, kind: "addon" }],
		});
		const loaded: LoadedDefinitionRegistry = {
			...fixture,
			catalog: fixture.catalog.filter((entry) => entry.id !== addon.id),
		};
		lifecycleMocks.loadManagedProject.mockResolvedValue(
			managedProject({ registries: ["@acme/forge-x"] }),
		);
		lifecycleMocks.loadProjectRegistry.mockResolvedValue(loaded);

		await runAdd(addon.id, {});

		expect(lifecycleMocks.runPackageManagerOperation).not.toHaveBeenCalled();
		expect(lifecycleMocks.applyInstalledPlan).toHaveBeenCalledWith(
			".",
			{ slug: "acme", web: "nextjs" },
			[{ definitionId: addon.id, targets: [{ kind: "project" }] }],
			undefined,
			["@acme/forge-x"],
		);
	});

	it("rejects a versioned registry package before installing it", async () => {
		const exit = vi.spyOn(process, "exit").mockImplementation((code) => {
			throw new Error(`exit:${code ?? 0}`);
		});

		try {
			lifecycleMocks.loadManagedProject.mockResolvedValue(managedProject());

			await expect(runAdd("@acme/pkg@1.0.0", {})).rejects.toThrow("exit:1");

			expect(promptMocks.logError).toHaveBeenCalledWith(
				'We can\'t add "@acme/pkg@1.0.0" with a version. Pass the bare package name "@acme/pkg" instead.',
			);
			expect(lifecycleMocks.runPackageManagerOperation).not.toHaveBeenCalled();
			expect(lifecycleMocks.applyInstalledPlan).not.toHaveBeenCalled();
		} finally {
			exit.mockRestore();
		}
	});

	it("honors --no-install with a manual command", async () => {
		const exit = vi.spyOn(process, "exit").mockImplementation((code) => {
			throw new Error(`exit:${code ?? 0}`);
		});

		try {
			lifecycleMocks.loadManagedProject.mockResolvedValue(managedProject());

			await expect(
				runAdd("@acme/forge-sentry", { "no-install": true }),
			).rejects.toThrow("exit:1");

			expect(promptMocks.logError).toHaveBeenCalledWith(
				'We can\'t add @acme/forge-sentry without installing it. Run "pnpm add -D -w @acme/forge-sentry" inside the project, then try again.',
			);
			expect(lifecycleMocks.runPackageManagerOperation).not.toHaveBeenCalled();
			expect(lifecycleMocks.applyInstalledPlan).not.toHaveBeenCalled();
		} finally {
			exit.mockRestore();
		}
	});

	it("soft-fails a registry install with manual guidance", async () => {
		const exit = vi.spyOn(process, "exit").mockImplementation((code) => {
			throw new Error(`exit:${code ?? 0}`);
		});

		try {
			lifecycleMocks.loadManagedProject.mockResolvedValue(managedProject());
			lifecycleMocks.runPackageManagerOperation.mockResolvedValue(false);

			await expect(runAdd("@acme/forge-sentry", {})).rejects.toThrow("exit:1");

			expect(promptMocks.spinnerStop).toHaveBeenCalledWith(
				"We couldn't install @acme/forge-sentry.",
			);
			expect(promptMocks.logWarn).toHaveBeenCalledWith(
				'The install didn\'t finish, so run "pnpm add -D -w @acme/forge-sentry" yourself inside the project, then try again.',
			);
			expect(lifecycleMocks.applyInstalledPlan).not.toHaveBeenCalled();
		} finally {
			exit.mockRestore();
		}
	});

	it("adds the sole addon when re-adding its registered package", async () => {
		const firstParty = loadDefinitionRegistry();
		const sentry = defineAddon<ForgeConfig>({
			id: "@acme/sentry",
			name: "Sentry",
			version: "1.0.0",
			category: "tooling",
			exclusive: false,
			targetMode: "multiple",
			when: () => false,
			contribute: () => [],
		});

		lifecycleMocks.loadManagedProject.mockResolvedValue(
			managedProject({ registries: ["@acme/forge-sentry"] }),
		);
		lifecycleMocks.loadProjectRegistry.mockResolvedValue({
			catalog: [
				...firstParty.catalog,
				{
					available: true,
					category: "tooling",
					description: "Sentry observability.",
					experimental: false,
					hidden: false,
					id: "@acme/sentry",
					keywords: ["sentry"],
					kind: "addon",
					name: "Sentry",
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
				addons: [...firstParty.registry.addons, sentry],
			},
		});

		await runAdd("@acme/forge-sentry", {});

		expect(lifecycleMocks.runPackageManagerOperation).not.toHaveBeenCalled();
		expect(lifecycleMocks.applyInstalledPlan).toHaveBeenCalledWith(
			".",
			{ slug: "acme", web: "nextjs" },
			[
				{
					definitionId: "@acme/sentry",
					targets: [{ kind: "project" }],
				},
			],
			undefined,
			["@acme/forge-sentry"],
		);
	});

	it("searches the curated addon catalog when called without an id", async () => {
		lifecycleMocks.loadManagedProject.mockResolvedValue(managedProject());
		promptMocks.text.mockResolvedValue("tailwind");

		await runAdd(undefined, {});

		expect(promptMocks.text).toHaveBeenCalledWith({
			message: "Search for an addon (leave blank to browse).",
			placeholder: "tailwind, auth, trpc...",
		});
		expect(promptMocks.select).not.toHaveBeenCalled();
		expect(promptMocks.multiselect).not.toHaveBeenCalled();
		expect(lifecycleMocks.loadManagedProject).toHaveBeenCalledWith(".", "add");
		expect(lifecycleMocks.applyInstalledPlan).toHaveBeenCalledWith(
			".",
			{ slug: "acme", style: "tailwind", web: "nextjs" },
			[{ definitionId: "tailwind", targets: [{ kind: "project" }] }],
			undefined,
			undefined,
		);
	});

	it("forwards opted-in registries when applying an addon", async () => {
		lifecycleMocks.loadManagedProject.mockResolvedValue(
			managedProject({ registries: ["@acme/forge-sentry"] }),
		);

		await runAdd("tailwind", {});

		expect(lifecycleMocks.applyInstalledPlan).toHaveBeenCalledWith(
			".",
			{ slug: "acme", style: "tailwind", web: "nextjs" },
			[{ definitionId: "tailwind", targets: [{ kind: "project" }] }],
			undefined,
			["@acme/forge-sentry"],
		);
	});

	it("offers every visible addon when the search is left blank", async () => {
		lifecycleMocks.loadManagedProject.mockResolvedValue(managedProject());
		promptMocks.text.mockResolvedValue("");
		promptMocks.select.mockResolvedValue("tailwind");

		await runAdd(undefined, {});

		expect(promptMocks.select).toHaveBeenCalledWith({
			message: "Which addon do you want to add?",
			options: listVisibleAddons().map((entry) => ({
				hint: entry.summary,
				label: entry.name,
				value: entry.id,
			})),
		});
		expect(lifecycleMocks.applyInstalledPlan).toHaveBeenCalledWith(
			".",
			{ slug: "acme", style: "tailwind", web: "nextjs" },
			[{ definitionId: "tailwind", targets: [{ kind: "project" }] }],
			undefined,
			undefined,
		);
	});

	it("keeps hidden addons out of the search results", async () => {
		const exit = vi.spyOn(process, "exit").mockImplementation(((
			code?: string | number | null,
		) => {
			throw new Error(`exit:${code ?? 0}`);
		}) as never);

		try {
			lifecycleMocks.loadManagedProject.mockResolvedValue(managedProject());
			promptMocks.text.mockResolvedValue("root");

			await expect(runAdd(undefined, {})).rejects.toThrow("exit:1");

			expect(promptMocks.logError).toHaveBeenCalledWith(
				"We couldn't find an addon matching that search.",
			);
			expect(lifecycleMocks.applyInstalledPlan).not.toHaveBeenCalled();
		} finally {
			exit.mockRestore();
		}
	});

	it("keeps announced addons out of the search results", async () => {
		const exit = vi.spyOn(process, "exit").mockImplementation((code) => {
			throw new Error(`exit:${code ?? 0}`);
		});

		try {
			lifecycleMocks.loadManagedProject.mockResolvedValue(managedProject());
			promptMocks.text.mockResolvedValue("authjs");

			await expect(runAdd(undefined, {})).rejects.toThrow("exit:1");

			expect(promptMocks.logError).toHaveBeenCalledWith(
				"We couldn't find an addon matching that search.",
			);
			expect(promptMocks.select).not.toHaveBeenCalled();
			expect(lifecycleMocks.applyInstalledPlan).not.toHaveBeenCalled();
		} finally {
			exit.mockRestore();
		}
	});

	it("cancels the run when the addon search is dismissed", async () => {
		const exit = vi.spyOn(process, "exit").mockImplementation(((
			code?: string | number | null,
		) => {
			throw new Error(`exit:${code ?? 0}`);
		}) as never);

		try {
			lifecycleMocks.loadManagedProject.mockResolvedValue(managedProject());
			const cancelSentinel = Symbol("cancelled");
			promptMocks.text.mockResolvedValue(cancelSentinel);
			promptMocks.isCancel.mockImplementation(
				(value: unknown) => value === cancelSentinel,
			);

			await expect(runAdd(undefined, {})).rejects.toThrow("exit:0");

			expect(promptMocks.cancel).toHaveBeenCalledWith(
				"You've extinguished the forge.",
			);
			expect(lifecycleMocks.applyInstalledPlan).not.toHaveBeenCalled();
		} finally {
			exit.mockRestore();
		}
	});

	it("installs a project-level addon without prompting even when multiple modules exist", async () => {
		lifecycleMocks.loadManagedProject.mockResolvedValue(
			managedProject({ modules: [appModule, adminModule] }),
		);

		await runAdd("tailwind", {});

		expect(promptMocks.select).not.toHaveBeenCalled();
		expect(promptMocks.multiselect).not.toHaveBeenCalled();
		expect(lifecycleMocks.applyInstalledPlan).toHaveBeenCalledWith(
			".",
			{ slug: "acme", style: "tailwind", web: "nextjs" },
			[{ definitionId: "tailwind", targets: [{ kind: "project" }] }],
			undefined,
			undefined,
		);
	});

	it("sets the mapped config field when adding an orm", async () => {
		lifecycleMocks.loadManagedProject.mockResolvedValue(managedProject());

		await runAdd("prisma", {});

		expect(lifecycleMocks.applyInstalledPlan).toHaveBeenCalledWith(
			".",
			{ orm: "prisma", slug: "acme", web: "nextjs" },
			[{ definitionId: "prisma", targets: [{ kind: "project" }] }],
			undefined,
			undefined,
		);
	});

	it("rejects adding a second orm instead of swapping", async () => {
		const exit = vi.spyOn(process, "exit").mockImplementation(((
			code?: string | number | null,
		) => {
			throw new Error(`exit:${code ?? 0}`);
		}) as never);

		try {
			lifecycleMocks.loadManagedProject.mockResolvedValue(
				managedProject({
					config: { orm: "drizzle", slug: "acme", web: "nextjs" },
					installs: [
						{ definitionId: "drizzle", targets: [{ kind: "project" }] },
					],
				}),
			);

			await expect(runAdd("prisma", {})).rejects.toThrow("exit:1");

			expect(promptMocks.logError).toHaveBeenCalledWith(
				"This project already uses Drizzle.",
			);
			expect(lifecycleMocks.applyInstalledPlan).not.toHaveBeenCalled();
		} finally {
			exit.mockRestore();
		}
	});

	it("refuses to switch package managers", async () => {
		const exit = vi.spyOn(process, "exit").mockImplementation(((
			code?: string | number | null,
		) => {
			throw new Error(`exit:${code ?? 0}`);
		}) as never);

		try {
			lifecycleMocks.loadManagedProject.mockResolvedValue(managedProject());

			await expect(runAdd("yarn", {})).rejects.toThrow("exit:1");

			expect(promptMocks.logError).toHaveBeenCalledWith(
				"We can't switch package managers yet.",
			);
			expect(lifecycleMocks.applyInstalledPlan).not.toHaveBeenCalled();
		} finally {
			exit.mockRestore();
		}
	});

	it("requires an orm before adding better-auth", async () => {
		const exit = vi.spyOn(process, "exit").mockImplementation(((
			code?: string | number | null,
		) => {
			throw new Error(`exit:${code ?? 0}`);
		}) as never);

		try {
			lifecycleMocks.loadManagedProject.mockResolvedValue(managedProject());

			await expect(runAdd("better-auth", {})).rejects.toThrow("exit:1");

			expect(promptMocks.logError).toHaveBeenCalledWith(
				"You need to add an ORM before you can use Better Auth.",
			);
			expect(lifecycleMocks.applyInstalledPlan).not.toHaveBeenCalled();
		} finally {
			exit.mockRestore();
		}
	});

	it("adds better-auth once an orm is installed", async () => {
		lifecycleMocks.loadManagedProject.mockResolvedValue(
			managedProject({
				config: { orm: "drizzle", slug: "acme", web: "nextjs" },
				installs: [{ definitionId: "drizzle", targets: [{ kind: "project" }] }],
			}),
		);

		await runAdd("better-auth", {});

		expect(lifecycleMocks.applyInstalledPlan).toHaveBeenCalledWith(
			".",
			{
				authentication: "better-auth",
				orm: "drizzle",
				slug: "acme",
				web: "nextjs",
			},
			[
				{ definitionId: "drizzle", targets: [{ kind: "project" }] },
				{
					definitionId: "better-auth",
					targets: [{ kind: "module", moduleId: appModule.id }],
				},
			],
			undefined,
			undefined,
		);
	});

	it("records opt-in addons on the config so contributions stay in sync", async () => {
		lifecycleMocks.loadManagedProject.mockResolvedValue(
			managedProject({ config: { addons: ["lefthook"], slug: "acme" } }),
		);

		await runAdd("commitlint", {});

		expect(lifecycleMocks.applyInstalledPlan).toHaveBeenCalledWith(
			".",
			{ addons: ["lefthook", "commitlint"], slug: "acme" },
			[{ definitionId: "commitlint", targets: [{ kind: "project" }] }],
			undefined,
			undefined,
		);
	});

	it("installs a compatible addon into the only matching module without prompting", async () => {
		lifecycleMocks.loadManagedProject.mockResolvedValue(managedProject());

		await runAdd("mock-single", {});

		expect(promptMocks.select).not.toHaveBeenCalled();
		expect(promptMocks.multiselect).not.toHaveBeenCalled();
		expect(lifecycleMocks.applyInstalledPlan).toHaveBeenCalledWith(
			".",
			{ slug: "acme", web: "nextjs" },
			[
				{
					definitionId: "mock-single",
					targets: [{ kind: "module", moduleId: appModule.id }],
				},
			],
			undefined,
			undefined,
		);
	});

	it("uses the first compatible module for a single-target addon", async () => {
		lifecycleMocks.loadManagedProject.mockResolvedValue(
			managedProject({ modules: [appModule, adminModule] }),
		);

		await runAdd("mock-single", {});

		expect(promptMocks.select).not.toHaveBeenCalled();
		expect(promptMocks.multiselect).not.toHaveBeenCalled();
		expect(lifecycleMocks.applyInstalledPlan).toHaveBeenCalledWith(
			".",
			{ slug: "acme", web: "nextjs" },
			[
				{
					definitionId: "mock-single",
					targets: [{ kind: "module", moduleId: appModule.id }],
				},
			],
			undefined,
			undefined,
		);
	});

	it("skips package modules when adding an adapter addon", async () => {
		lifecycleMocks.loadManagedProject.mockResolvedValue(
			managedProject({ modules: [packageModule, appModule] }),
		);

		await runAdd("trpc", {});

		expect(lifecycleMocks.applyInstalledPlan).toHaveBeenCalledWith(
			".",
			{ rpc: "trpc", slug: "acme", web: "nextjs" },
			[
				{
					definitionId: "trpc",
					targets: [{ kind: "module", moduleId: appModule.id }],
				},
			],
			undefined,
			undefined,
		);
	});

	it("replaces the install record with the first compatible module", async () => {
		lifecycleMocks.loadManagedProject.mockResolvedValue(
			managedProject({
				installs: [
					{ definitionId: "tailwind", targets: [{ kind: "project" }] },
					{
						definitionId: "mock-single",
						targets: [{ kind: "module", moduleId: appModule.id }],
					},
				],
				modules: [adminModule, appModule],
			}),
		);

		await runAdd("mock-single", {});

		expect(lifecycleMocks.applyInstalledPlan).toHaveBeenCalledWith(
			".",
			{ slug: "acme", web: "nextjs" },
			[
				{ definitionId: "tailwind", targets: [{ kind: "project" }] },
				{
					definitionId: "mock-single",
					targets: [{ kind: "module", moduleId: adminModule.id }],
				},
			],
			undefined,
			undefined,
		);
	});

	it("records every compatible module for a multiple-target addon", async () => {
		lifecycleMocks.loadManagedProject.mockResolvedValue(
			managedProject({ modules: [appModule, adminModule] }),
		);

		await runAdd("mock-multi", {});

		expect(promptMocks.select).not.toHaveBeenCalled();
		expect(promptMocks.multiselect).not.toHaveBeenCalled();
		expect(lifecycleMocks.applyInstalledPlan).toHaveBeenCalledWith(
			".",
			{ slug: "acme", web: "nextjs" },
			[
				{
					definitionId: "mock-multi",
					targets: [
						{ kind: "module", moduleId: appModule.id },
						{ kind: "module", moduleId: adminModule.id },
					],
				},
			],
			undefined,
			undefined,
		);
	});

	it("merges new module targets into an existing multi-target install without duplicates", async () => {
		lifecycleMocks.loadManagedProject.mockResolvedValue(
			managedProject({
				installs: [
					{ definitionId: "tailwind", targets: [{ kind: "project" }] },
					{
						definitionId: "mock-multi",
						targets: [{ kind: "module", moduleId: appModule.id }],
					},
				],
				modules: [appModule, adminModule],
			}),
		);

		promptMocks.multiselect.mockResolvedValue([appModule.id, adminModule.id]);

		await runAdd("mock-multi", {});

		expect(lifecycleMocks.applyInstalledPlan).toHaveBeenCalledWith(
			".",
			{ slug: "acme", web: "nextjs" },
			[
				{ definitionId: "tailwind", targets: [{ kind: "project" }] },
				{
					definitionId: "mock-multi",
					targets: [
						{ kind: "module", moduleId: appModule.id },
						{ kind: "module", moduleId: adminModule.id },
					],
				},
			],
			undefined,
			undefined,
		);
	});

	it("keeps config and installs unchanged when re-adding an installed addon", async () => {
		lifecycleMocks.loadManagedProject.mockResolvedValue(
			managedProject({
				config: { slug: "acme", style: "tailwind", web: "nextjs" },
				installs: [
					{ definitionId: "tailwind", targets: [{ kind: "project" }] },
				],
			}),
		);

		await runAdd("tailwind", {});

		expect(lifecycleMocks.applyInstalledPlan).toHaveBeenCalledWith(
			".",
			{ slug: "acme", style: "tailwind", web: "nextjs" },
			[{ definitionId: "tailwind", targets: [{ kind: "project" }] }],
			undefined,
			undefined,
		);
	});

	it("shows a friendly error when no module is compatible", async () => {
		const exit = vi.spyOn(process, "exit").mockImplementation(((
			code?: string | number | null,
		) => {
			throw new Error(`exit:${code ?? 0}`);
		}) as never);

		try {
			lifecycleMocks.loadManagedProject.mockResolvedValue(
				managedProject({ modules: [reactRouterModule] }),
			);

			await expect(runAdd("mock-single", {})).rejects.toThrow("exit:1");

			expect(promptMocks.logError).toHaveBeenCalledWith(
				'We couldn\'t find a compatible target for "Mock Single".',
			);
			expect(lifecycleMocks.applyInstalledPlan).not.toHaveBeenCalled();
		} finally {
			exit.mockRestore();
		}
	});

	it("reports adapter support when the project framework is unsupported", async () => {
		const exit = vi.spyOn(process, "exit").mockImplementation(((
			code?: string | number | null,
		) => {
			throw new Error(`exit:${code ?? 0}`);
		}) as never);

		try {
			lifecycleMocks.loadManagedProject.mockResolvedValue(
				managedProject({ modules: [packageModule, reactRouterModule] }),
			);

			await expect(runAdd("trpc", {})).rejects.toThrow("exit:1");

			expect(promptMocks.logError).toHaveBeenCalledWith(
				"tRPC does not support React Router yet.",
			);
			expect(lifecycleMocks.applyInstalledPlan).not.toHaveBeenCalled();
		} finally {
			exit.mockRestore();
		}
	});

	it("shows a friendly error when the addon id is unknown", async () => {
		const exit = vi.spyOn(process, "exit").mockImplementation(((
			code?: string | number | null,
		) => {
			throw new Error(`exit:${code ?? 0}`);
		}) as never);

		try {
			lifecycleMocks.loadManagedProject.mockResolvedValue(managedProject());

			await expect(runAdd("missing", {})).rejects.toThrow("exit:1");

			expect(promptMocks.logError).toHaveBeenCalledWith(
				'We couldn\'t find the "missing" addon.',
			);
			expect(lifecycleMocks.applyInstalledPlan).not.toHaveBeenCalled();
		} finally {
			exit.mockRestore();
		}
	});

	it("shows the unavailable message for an announced addon id", async () => {
		const exit = vi.spyOn(process, "exit").mockImplementation((code) => {
			throw new Error(`exit:${code ?? 0}`);
		});

		try {
			lifecycleMocks.loadManagedProject.mockResolvedValue(managedProject());

			await expect(runAdd("authjs", {})).rejects.toThrow("exit:1");

			expect(promptMocks.logError).toHaveBeenCalledWith(
				'"Auth.js" isn\'t available yet.',
			);
			expect(lifecycleMocks.applyInstalledPlan).not.toHaveBeenCalled();
		} finally {
			exit.mockRestore();
		}
	});

	it("rethrows unexpected registry failures instead of hiding them", async () => {
		lifecycleMocks.loadManagedProject.mockResolvedValue(managedProject());

		await expect(runAdd("mock-broken", {})).rejects.toThrow(
			"Registry Offline: mock-broken",
		);

		expect(promptMocks.logError).not.toHaveBeenCalled();
		expect(lifecycleMocks.applyInstalledPlan).not.toHaveBeenCalled();
	});
});
