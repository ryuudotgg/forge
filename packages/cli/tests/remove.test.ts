import {
	type DiscoveredModule,
	defineAdapter,
	defineAddon,
} from "@ryuugg/core";
import * as generators from "@ryuugg/generators";
import {
	type AuthMethod,
	type ForgeConfig,
	type LoadedDefinitionRegistry,
	loadDefinitionRegistry,
	type RegistryUnit,
} from "@ryuugg/generators";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { runRemove } from "../src/commands/remove";
import {
	adminModule,
	appModule,
	failingAddonRegistry,
	managedProject,
	planningFailures,
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
	logInfo: vi.fn(),
	logSuccess: vi.fn(),
	logWarn: vi.fn(),
	multiselect: vi.fn(),
	select: vi.fn(),
	text: vi.fn(),
}));

const lifecycleMocks = vi.hoisted(() => ({
	applyInstalledPlan: vi.fn(),
	configuredPackageManager: vi.fn(),
	generatedRemovalPaths: vi.fn(async (): Promise<string[]> => []),
	hasProjectDevDependency: vi.fn(),
	loadManagedProject: vi.fn(),
	loadProjectRegistry: vi.fn(),
	runPackageManagerOperation: vi.fn(),
}));

vi.mock("@clack/prompts", () => ({
	confirm: promptMocks.confirm,
	intro: promptMocks.intro,
	isCancel: () => false,
	log: {
		error: promptMocks.logError,
		info: promptMocks.logInfo,
		success: promptMocks.logSuccess,
		warn: promptMocks.logWarn,
	},
	multiselect: promptMocks.multiselect,
	select: promptMocks.select,
	text: promptMocks.text,
}));

vi.mock("../src/commands/lifecycle", () => ({
	applyInstalledPlan: lifecycleMocks.applyInstalledPlan,
	configuredPackageManager: lifecycleMocks.configuredPackageManager,
	generatedRemovalPaths: lifecycleMocks.generatedRemovalPaths,
	hasProjectDevDependency: lifecycleMocks.hasProjectDevDependency,
	loadManagedProject: lifecycleMocks.loadManagedProject,
	loadProjectRegistry: lifecycleMocks.loadProjectRegistry,
	runPackageManagerOperation: lifecycleMocks.runPackageManagerOperation,
}));

describe("remove command", () => {
	it.each(planningFailures)(
		"prints planning failure: $message",
		async ({ failure, message }) => {
			const loaded = failingAddonRegistry(failure);
			const registry = vi
				.spyOn(generators, "loadDefinitionRegistry")
				.mockReturnValue(loaded);

			const lifecycle = await vi.importActual<
				typeof import("../src/commands/lifecycle")
			>("../src/commands/lifecycle");

			const exit = vi.spyOn(process, "exit").mockImplementation((code) => {
				throw new Error(`exit:${code ?? 0}`);
			});

			lifecycleMocks.loadManagedProject.mockResolvedValue(
				managedProject({
					config: { slug: "acme", addons: ["vitest"] },
					modules: [],
					installs: [
						{ definitionId: "test-refusal", targets: [{ kind: "project" }] },
						{ definitionId: "vitest", targets: [{ kind: "project" }] },
					],
				}),
			);

			lifecycleMocks.loadProjectRegistry.mockResolvedValue(loaded);
			lifecycleMocks.applyInstalledPlan.mockImplementation(
				(...args: Parameters<typeof lifecycle.applyInstalledPlan>) =>
					lifecycle.applyInstalledPlan(args[0], args[1], args[2], {
						node: "22.11.0",
						pnpm: "10.12.1",
					}),
			);

			try {
				await expect(runRemove("vitest", {})).rejects.toThrow("exit:1");
				expect(promptMocks.logError).toHaveBeenCalledExactlyOnceWith(message);
				expect(exit).toHaveBeenCalledWith(1);
			} finally {
				registry.mockRestore();
				exit.mockRestore();
			}
		},
	);

	it("reports a removed secondary name clearly on rerun", async () => {
		const exit = vi.spyOn(process, "exit").mockImplementation((code) => {
			throw new Error(`exit:${code ?? 0}`);
		});

		lifecycleMocks.loadManagedProject.mockResolvedValue(
			managedProject({ config: { web: "nextjs", webApps: [] } }),
		);

		try {
			await expect(runRemove("site", { yes: true })).rejects.toThrow("exit:1");

			expect(promptMocks.logError).toHaveBeenCalledWith(
				'We couldn\'t find "site" in this project.',
			);

			expect(lifecycleMocks.applyInstalledPlan).not.toHaveBeenCalled();
		} finally {
			exit.mockRestore();
		}
	});

	it.each(["admin", "apps/admin", adminModule.id, "react-router"])(
		"removes a secondary app by %s and strips only its install targets",
		async (requestedId) => {
			const project = managedProject({
				config: {
					web: "nextjs",
					webApps: [{ name: "admin", framework: "react-router" }],
				},
				modules: [
					appModule,
					{ ...adminModule, type: "app", framework: "react-router" },
				],
				installs: [
					{
						definitionId: "tailwind",
						targets: [
							{ kind: "module", moduleId: appModule.id },
							{ kind: "module", moduleId: adminModule.id },
						],
					},
					{ definitionId: "biome", targets: [{ kind: "project" }] },
					{
						definitionId: "mock-multi",
						targets: [{ kind: "module", moduleId: adminModule.id }],
					},
				],
			});

			lifecycleMocks.loadManagedProject.mockResolvedValue(project);

			await runRemove(requestedId, { yes: true, "keep-user": true });

			expect(lifecycleMocks.applyInstalledPlan).toHaveBeenCalledWith(
				project.projectRoot,
				{ web: "nextjs", webApps: [] },
				[
					{
						definitionId: "tailwind",
						targets: [{ kind: "module", moduleId: appModule.id }],
					},
					{ definitionId: "biome", targets: [{ kind: "project" }] },
				],
				undefined,
				undefined,
				{ resolutionPolicy: "keep-user" },
				{
					modules: [appModule],
					records: project.manifest.modules,
					removedRoots: ["apps/admin"],
				},
			);
		},
	);

	it.each([
		{ root: "sites/admin", recordedRoot: undefined },
		{ root: "sites/admin", recordedRoot: "sites/admin" },
		{ root: "sites/dashboard", recordedRoot: "sites/admin" },
		{ root: "sites/dashboard", recordedRoot: "apps/admin" },
	])(
		"removes an adopted secondary at $root with recorded root $recordedRoot",
		async ({ root, recordedRoot }) => {
			const adoptedModule = {
				...adminModule,
				packageName: "@company/control-panel",
				root,
			};

			const baseProject = managedProject({
				config: {
					web: "nextjs",
					webApps: [{ name: "admin", framework: "nextjs" }],
				},
				modules: [appModule, adoptedModule],
			});

			const project = {
				...baseProject,
				manifest: {
					...baseProject.manifest,
					modules:
						recordedRoot === undefined
							? {}
							: {
									[adoptedModule.id]: {
										root: recordedRoot,
										definitionIds: [],
									},
								},
				},
			};

			lifecycleMocks.loadManagedProject.mockResolvedValue(project);

			await runRemove("admin", { yes: true });

			expect(lifecycleMocks.applyInstalledPlan).toHaveBeenCalledWith(
				project.projectRoot,
				{ web: "nextjs", webApps: [] },
				[],
				undefined,
				undefined,
				{},
				{
					modules: [appModule],
					records: project.manifest.modules,
					...(recordedRoot === undefined || recordedRoot === root
						? {}
						: { removalRootRelocations: { [recordedRoot]: root } }),
					removedRoots: [root],
				},
			);
		},
	);

	it.each([
		{ root: "sites/dashboard", recordedRoot: "apps/admin" },
		{ root: "sites/admin", recordedRoot: "sites/admin" },
	])(
		"removes generated paths at $root using recorded root $recordedRoot",
		async ({ root, recordedRoot }) => {
			const adoptedModule = {
				...adminModule,
				packageName: "@company/control-panel",
				root,
			};
			const baseProject = managedProject({
				config: {
					web: "nextjs",
					webApps: [{ name: "admin", framework: "nextjs" }],
				},
				modules: [appModule, adoptedModule],
			});
			const project = {
				...baseProject,
				manifest: {
					...baseProject.manifest,
					modules: {
						[adoptedModule.id]: { root: recordedRoot, definitionIds: [] },
					},
				},
			};

			lifecycleMocks.loadManagedProject.mockResolvedValue(project);
			lifecycleMocks.generatedRemovalPaths.mockResolvedValueOnce([
				`${root}/src/routeTree.gen.ts`,
				"apps/web/src/routeTree.gen.ts",
			]);

			await runRemove("admin", { yes: true });

			expect(lifecycleMocks.generatedRemovalPaths).toHaveBeenLastCalledWith(
				project.projectRoot,
				project.config,
				project.manifest.installs,
				project.manifest.registries,
				project.modules,
				project.manifest.modules,
				[root],
			);

			expect(lifecycleMocks.applyInstalledPlan).toHaveBeenCalledWith(
				project.projectRoot,
				{ web: "nextjs", webApps: [] },
				[],
				undefined,
				undefined,
				{},
				{
					generatedRemovals: [
						`${recordedRoot}/src/routeTree.gen.ts`,
						"apps/web/src/routeTree.gen.ts",
					],
					modules: [appModule],
					records: project.manifest.modules,
					...(recordedRoot === root
						? {}
						: { removalRootRelocations: { [recordedRoot]: root } }),
					removedRoots: [root],
				},
			);
		},
	);

	it.each([
		{
			root: "apps/admin",
			packageName: "@company/control",
			recordedRoot: undefined,
		},
		{
			root: "sites/control",
			packageName: "@acme/admin",
			recordedRoot: undefined,
		},
		{
			root: "sites/control",
			packageName: "@company/control",
			recordedRoot: "apps/admin",
		},
	])(
		"prefers explicit secondary identity at $root over a shared basename",
		async ({ root, packageName, recordedRoot }) => {
			const selectedModule = { ...adminModule, root, packageName };
			const unrelatedModule = {
				...adminModule,
				id: "other",
				root: "tools/admin",
				packageName: "@company/other",
			};

			const baseProject = managedProject({
				config: {
					slug: "acme",
					web: "nextjs",
					webApps: [{ name: "admin", framework: "nextjs" }],
				},
				modules: [appModule, selectedModule, unrelatedModule],
			});

			const project = {
				...baseProject,
				manifest: {
					...baseProject.manifest,
					modules:
						recordedRoot === undefined
							? {}
							: {
									[selectedModule.id]: {
										root: recordedRoot,
										definitionIds: [],
									},
								},
				},
			};

			lifecycleMocks.loadManagedProject.mockResolvedValue(project);

			await runRemove("admin", { yes: true });

			expect(lifecycleMocks.applyInstalledPlan).toHaveBeenCalledWith(
				project.projectRoot,
				{ slug: "acme", web: "nextjs", webApps: [] },
				[],
				undefined,
				undefined,
				{},
				{
					modules: [appModule, unrelatedModule],
					records: project.manifest.modules,
					...(recordedRoot === undefined
						? {}
						: {
								removalRootRelocations: { [recordedRoot]: root },
							}),
					removedRoots: [root],
				},
			);
		},
	);

	it.each(["legacy-console", "@company/legacy-console"])(
		"finds an adopted secondary named after its package %s",
		async (packageName) => {
			const selectedModule = {
				...adminModule,
				root: "sites/admin",
				packageName,
			};

			const project = managedProject({
				config: {
					slug: "acme",
					web: "nextjs",
					webApps: [{ name: "legacy-console", framework: "nextjs" }],
				},
				modules: [appModule, selectedModule],
			});

			lifecycleMocks.loadManagedProject.mockResolvedValue(project);

			await runRemove("legacy-console", { yes: true });

			expect(lifecycleMocks.applyInstalledPlan).toHaveBeenCalledWith(
				project.projectRoot,
				{ slug: "acme", web: "nextjs", webApps: [] },
				[],
				undefined,
				undefined,
				{},
				{
					modules: [appModule],
					records: project.manifest.modules,
					removedRoots: ["sites/admin"],
				},
			);
		},
	);

	it("refuses when the canonical root and the generated package name point at different apps", async () => {
		const exit = vi.spyOn(process, "exit").mockImplementation((code) => {
			throw new Error(`exit:${code ?? 0}`);
		});

		const project = managedProject({
			config: {
				slug: "acme",
				web: "nextjs",
				webApps: [
					{ name: "admin", framework: "nextjs" },
					{ name: "dashboard", framework: "nextjs" },
				],
			},
			modules: [
				appModule,
				{ ...adminModule, packageName: "@acme/console" },
				{
					...adminModule,
					id: "dashboard",
					root: "apps/dashboard",
					packageName: "@acme/admin",
				},
			],
		});

		lifecycleMocks.loadManagedProject.mockResolvedValue(project);

		try {
			await expect(runRemove("admin", { yes: true })).rejects.toThrow("exit:1");

			expect(promptMocks.logError).toHaveBeenCalledWith(
				'We can\'t identify one managed web app named "admin".',
			);

			expect(lifecycleMocks.applyInstalledPlan).not.toHaveBeenCalled();
		} finally {
			exit.mockRestore();
		}
	});

	it("removes a secondary whose directory is gone through its manifest record", async () => {
		const baseProject = managedProject({
			config: {
				web: "nextjs",
				webApps: [{ name: "admin", framework: "nextjs" }],
			},
			modules: [appModule],
			installs: [
				{
					definitionId: "tailwind",
					targets: [
						{ kind: "module", moduleId: appModule.id },
						{ kind: "module", moduleId: adminModule.id },
					],
				},
			],
		});

		const project = {
			...baseProject,
			manifest: {
				...baseProject.manifest,
				modules: {
					...baseProject.manifest.modules,
					[adminModule.id]: {
						definitionIds: ["nextjs/base"],
						root: "apps/admin",
					},
				},
			},
		};

		lifecycleMocks.loadManagedProject.mockResolvedValue(project);

		await runRemove("admin", { yes: true });

		expect(lifecycleMocks.applyInstalledPlan).toHaveBeenCalledWith(
			project.projectRoot,
			{ web: "nextjs", webApps: [] },
			[
				{
					definitionId: "tailwind",
					targets: [{ kind: "module", moduleId: appModule.id }],
				},
			],
			undefined,
			undefined,
			{},
			{
				modules: [appModule],
				records: project.manifest.modules,
				removedRoots: ["apps/admin"],
			},
		);
	});

	it("drops a configured secondary with no record and no module from the config", async () => {
		const project = managedProject({
			config: {
				web: "nextjs",
				webApps: [{ name: "admin", framework: "nextjs" }],
			},
			modules: [appModule],
		});

		lifecycleMocks.loadManagedProject.mockResolvedValue(project);

		await runRemove("admin", { yes: true, "accept-forge": true });

		expect(lifecycleMocks.applyInstalledPlan).toHaveBeenCalledWith(
			project.projectRoot,
			{ web: "nextjs", webApps: [] },
			project.manifest.installs,
			undefined,
			undefined,
			{ resolutionPolicy: "accept-forge" },
			{
				modules: project.modules,
				records: project.manifest.modules,
				removedRoots: [],
			},
		);
	});

	it("refuses a missing secondary whose records are ambiguous", async () => {
		const exit = vi.spyOn(process, "exit").mockImplementation((code) => {
			throw new Error(`exit:${code ?? 0}`);
		});

		const baseProject = managedProject({
			config: {
				web: "nextjs",
				webApps: [{ name: "admin", framework: "nextjs" }],
			},
			modules: [appModule],
		});

		lifecycleMocks.loadManagedProject.mockResolvedValue({
			...baseProject,
			manifest: {
				...baseProject.manifest,
				modules: {
					one: { definitionIds: [], root: "sites/admin" },
					two: { definitionIds: [], root: "tools/admin" },
				},
			},
		});

		try {
			await expect(runRemove("admin", { yes: true })).rejects.toThrow("exit:1");

			expect(promptMocks.logError).toHaveBeenCalledWith(
				'We can\'t identify one managed web app named "admin".',
			);

			expect(lifecycleMocks.applyInstalledPlan).not.toHaveBeenCalled();
		} finally {
			exit.mockRestore();
		}
	});

	describe("a web app named after an installed addon", () => {
		const biomeApp = {
			...adminModule,
			packageName: "@acme/biome",
			root: "apps/biome",
		};

		const collidingProject = () =>
			managedProject({
				config: {
					linter: "biome",
					web: "nextjs",
					webApps: [{ name: "biome", framework: "nextjs" }],
				},
				modules: [appModule, biomeApp],
				installs: [{ definitionId: "biome", targets: [{ kind: "project" }] }],
			});

		async function interactively(run: () => Promise<void>) {
			const stdin = process.stdin.isTTY;
			const stdout = process.stdout.isTTY;
			const ci = process.env.CI;

			process.stdin.isTTY = true;
			process.stdout.isTTY = true;
			delete process.env.CI;

			try {
				await run();
			} finally {
				process.stdin.isTTY = stdin;
				process.stdout.isTTY = stdout;

				if (ci === undefined) delete process.env.CI;
				else process.env.CI = ci;
			}
		}

		it("asks which one and removes the addon when the user picks it", async () => {
			const project = collidingProject();
			lifecycleMocks.loadManagedProject.mockResolvedValue(project);
			promptMocks.select.mockResolvedValue("addon");

			await interactively(() => runRemove("biome", {}));

			expect(promptMocks.select).toHaveBeenCalledWith({
				message: "Do you want to remove the biome web app or the Biome addon?",
				initialValue: "app",
				options: [
					{ label: "The biome web app", value: "app" },
					{ label: "The Biome addon", value: "addon" },
				],
			});

			expect(lifecycleMocks.applyInstalledPlan).toHaveBeenCalledTimes(1);
			expect(lifecycleMocks.applyInstalledPlan).toHaveBeenCalledWith(
				project.projectRoot,
				{
					web: "nextjs",
					webApps: [{ name: "biome", framework: "nextjs" }],
				},
				[],
				undefined,
				undefined,
			);
		});

		it("removes the app when the user picks it", async () => {
			const project = collidingProject();
			lifecycleMocks.loadManagedProject.mockResolvedValue(project);
			promptMocks.select.mockResolvedValue("app");

			await interactively(() => runRemove("biome", {}));

			expect(lifecycleMocks.applyInstalledPlan).toHaveBeenCalledWith(
				project.projectRoot,
				{ linter: "biome", web: "nextjs", webApps: [] },
				project.manifest.installs,
				undefined,
				undefined,
				{},
				{
					modules: [appModule],
					records: project.manifest.modules,
					removedRoots: ["apps/biome"],
				},
			);

			expect(promptMocks.logInfo).not.toHaveBeenCalled();
		});

		it("removes the app without asking under --yes and names the addon", async () => {
			lifecycleMocks.loadManagedProject.mockResolvedValue(collidingProject());

			await interactively(() => runRemove("biome", { yes: true }));

			expect(promptMocks.select).not.toHaveBeenCalled();
			expect(promptMocks.logInfo).toHaveBeenCalledWith(
				"The Biome addon is still installed. Run forge remove without a name to choose it.",
			);
		});

		it("does not ask when no installed addon shares the name", async () => {
			lifecycleMocks.loadManagedProject.mockResolvedValue(
				managedProject({
					config: {
						web: "nextjs",
						webApps: [{ name: "biome", framework: "nextjs" }],
					},
					modules: [appModule, biomeApp],
				}),
			);

			await interactively(() => runRemove("biome", {}));

			expect(promptMocks.select).not.toHaveBeenCalled();
			expect(promptMocks.logInfo).not.toHaveBeenCalled();
			expect(lifecycleMocks.applyInstalledPlan).toHaveBeenCalledTimes(1);
		});
	});

	it("removes a secondary named after an installed addon before the addon", async () => {
		const biomeApp = {
			...adminModule,
			packageName: "@acme/biome",
			root: "apps/biome",
		};

		const project = managedProject({
			config: {
				linter: "biome",
				web: "nextjs",
				webApps: [{ name: "biome", framework: "nextjs" }],
			},
			modules: [appModule, biomeApp],
			installs: [{ definitionId: "biome", targets: [{ kind: "project" }] }],
		});

		lifecycleMocks.loadManagedProject.mockResolvedValue(project);

		await runRemove("biome", { yes: true });

		expect(lifecycleMocks.applyInstalledPlan).toHaveBeenCalledWith(
			project.projectRoot,
			{ linter: "biome", web: "nextjs", webApps: [] },
			project.manifest.installs,
			undefined,
			undefined,
			{},
			{
				modules: [appModule],
				records: project.manifest.modules,
				removedRoots: ["apps/biome"],
			},
		);

		expect(promptMocks.intro).not.toHaveBeenCalled();
	});

	it.each([
		{
			declined: [],
			retained: ["apps/admin/app/page.tsx"],
			sentence: "We kept your edited file at apps/admin/app/page.tsx.",
		},
		{
			declined: [],
			retained: ["apps/admin/app/page.tsx", "apps/admin/package.json"],
			sentence:
				"We kept your edited files at apps/admin/app/page.tsx and apps/admin/package.json.",
		},
	])(
		"names the edited files it kept: $sentence",
		async ({ retained, sentence }) => {
			lifecycleMocks.loadManagedProject.mockResolvedValue(
				managedProject({
					config: {
						web: "nextjs",
						webApps: [{ name: "admin", framework: "nextjs" }],
					},
					modules: [appModule, adminModule],
				}),
			);

			lifecycleMocks.applyInstalledPlan.mockResolvedValue({ retained });

			await runRemove("admin", { yes: true });

			expect(promptMocks.logInfo).toHaveBeenCalledWith(sentence);
		},
	);

	const docsModule: DiscoveredModule = {
		...adminModule,
		id: "docs1",
		packageName: "@acme/docs",
		root: "apps/docs",
	};

	const siteModule: DiscoveredModule = {
		...adminModule,
		id: "site1",
		packageName: "@acme/site",
		root: "apps/site",
	};

	it.each([
		{
			label: "a client with another client left",
			removed: "docs",
			clients: ["admin", "docs"],
			webApps: [
				{ name: "admin", framework: "nextjs", client: true, port: 3002 },
				{ name: "site", framework: "nextjs", port: 3004 },
			],
			info: [
				'Remove http://localhost:3003 from WEB_URLS in .env. With only local apps, that leaves WEB_URLS="http://localhost:3002".',
			],
		},
		{
			label: "the last client",
			removed: "docs",
			clients: ["docs"],
			webApps: [
				{ name: "admin", framework: "nextjs", port: 3002 },
				{ name: "site", framework: "nextjs", port: 3004 },
			],
			info: [
				"Remove WEB_URLS from .env: no secondary web app calls the API now.",
			],
		},
		{
			label: "an app that is not a client",
			removed: "docs",
			clients: ["admin", "site"],
			webApps: [
				{ name: "admin", framework: "nextjs", client: true, port: 3002 },
				{ name: "site", framework: "nextjs", client: true, port: 3004 },
			],
			info: [],
		},
	] satisfies ReadonlyArray<{
		label: string;
		removed: string;
		clients: ReadonlyArray<string>;
		webApps: ForgeConfig["webApps"];
		info: ReadonlyArray<string>;
	}>)(
		"keeps survivor ports and reports removing $label",
		async ({ removed, clients, webApps, info }) => {
			lifecycleMocks.loadManagedProject.mockResolvedValue(
				managedProject({
					config: {
						web: "nextjs",
						webApps: ["admin", "docs", "site"].map((name) => ({
							name,
							framework: "nextjs",
							...(clients.includes(name) ? { client: true } : {}),
						})),
					},
					modules: [appModule, adminModule, docsModule, siteModule],
				}),
			);

			lifecycleMocks.applyInstalledPlan.mockResolvedValue({
				dependenciesChanged: false,
				declined: [],
				retained: [],
			});

			await runRemove(removed, { yes: true });

			expect(lifecycleMocks.applyInstalledPlan.mock.calls[0]?.[1]).toEqual({
				web: "nextjs",
				webApps,
			});

			expect(promptMocks.logSuccess.mock.calls).toEqual([
				["We removed the docs web app."],
			]);

			expect(promptMocks.logInfo.mock.calls).toEqual(
				info.map((sentence) => [sentence]),
			);
		},
	);

	it("names the recorded origin of a removed client", async () => {
		lifecycleMocks.loadManagedProject.mockResolvedValue(
			managedProject({
				config: {
					web: "nextjs",
					webApps: [
						{ name: "admin", framework: "nextjs", client: true, port: 3002 },
						{ name: "docs", framework: "nextjs", client: true, port: 3007 },
						{ name: "site", framework: "nextjs", client: true, port: 3004 },
					],
				},
				modules: [appModule, adminModule, docsModule, siteModule],
			}),
		);

		lifecycleMocks.applyInstalledPlan.mockResolvedValue({
			dependenciesChanged: false,
			declined: [],
			retained: [],
		});

		await runRemove("docs", { yes: true });

		expect(promptMocks.logInfo.mock.calls).toEqual([
			[
				'Remove http://localhost:3007 from WEB_URLS in .env. With only local apps, that leaves WEB_URLS="http://localhost:3002,http://localhost:3004".',
			],
		]);
	});

	it("reports the removal, then the env line, then the kept files", async () => {
		lifecycleMocks.loadManagedProject.mockResolvedValue(
			managedProject({
				config: {
					web: "nextjs",
					webApps: [{ name: "admin", framework: "nextjs", client: true }],
				},
				modules: [appModule, adminModule],
			}),
		);

		lifecycleMocks.applyInstalledPlan.mockResolvedValue({
			declined: [],
			retained: ["apps/admin/app/page.tsx"],
		});

		await runRemove("admin", { yes: true });

		expect(promptMocks.logInfo.mock.calls).toEqual([
			["Remove WEB_URLS from .env: no secondary web app calls the API now."],
			["We kept your edited file at apps/admin/app/page.tsx."],
		]);

		expect(promptMocks.logSuccess.mock.invocationCallOrder[0]).toBeLessThan(
			promptMocks.logInfo.mock.invocationCallOrder[0] ?? 0,
		);
	});

	it("reports the removal of a secondary whose directory is gone", async () => {
		lifecycleMocks.loadManagedProject.mockResolvedValue(
			managedProject({
				config: {
					web: "nextjs",
					webApps: [{ name: "admin", framework: "nextjs", client: true }],
				},
				modules: [appModule],
			}),
		);

		lifecycleMocks.applyInstalledPlan.mockResolvedValue({
			dependenciesChanged: false,
			declined: [],
			retained: [],
		});

		await runRemove("admin", { yes: true });

		expect(promptMocks.logSuccess.mock.calls).toEqual([
			["We removed the admin web app."],
		]);

		expect(promptMocks.logInfo.mock.calls).toEqual([
			["Remove WEB_URLS from .env: no secondary web app calls the API now."],
		]);
	});

	it("prints nothing when the removal fails to apply", async () => {
		lifecycleMocks.loadManagedProject.mockResolvedValue(
			managedProject({
				config: {
					web: "nextjs",
					webApps: [{ name: "admin", framework: "nextjs", client: true }],
				},
				modules: [appModule, adminModule],
			}),
		);

		lifecycleMocks.applyInstalledPlan.mockRejectedValue(new Error("exit:1"));

		await expect(runRemove("admin", { yes: true })).rejects.toThrow("exit:1");
		expect(promptMocks.logSuccess).not.toHaveBeenCalled();
		expect(promptMocks.logInfo).not.toHaveBeenCalled();
	});

	it("refuses ambiguous adopted secondary roots", async () => {
		const exit = vi.spyOn(process, "exit").mockImplementation((code) => {
			throw new Error(`exit:${code ?? 0}`);
		});

		const project = managedProject({
			config: {
				web: "nextjs",
				webApps: [{ name: "admin", framework: "nextjs" }],
			},
			modules: [
				appModule,
				{
					...adminModule,
					root: "sites/admin",
					packageName: "@company/control",
				},
				{
					...adminModule,
					id: "other",
					root: "tools/admin",
					packageName: "@company/other",
				},
			],
		});

		lifecycleMocks.loadManagedProject.mockResolvedValue(project);

		try {
			await expect(runRemove("admin", { yes: true })).rejects.toThrow("exit:1");

			expect(promptMocks.logError).toHaveBeenCalledWith(
				'We can\'t identify one managed web app named "admin".',
			);

			expect(lifecycleMocks.applyInstalledPlan).not.toHaveBeenCalled();
		} finally {
			exit.mockRestore();
		}
	});

	it("removes a secondary app named primary", async () => {
		const project = managedProject({
			config: {
				web: "nextjs",
				webApps: [{ name: "primary", framework: "nextjs" }],
			},
			modules: [
				appModule,
				{ ...adminModule, root: "apps/primary", packageName: "@acme/primary" },
			],
		});

		lifecycleMocks.loadManagedProject.mockResolvedValue(project);

		await runRemove("primary", { yes: true });

		expect(lifecycleMocks.applyInstalledPlan).toHaveBeenCalledWith(
			project.projectRoot,
			{ web: "nextjs", webApps: [] },
			[],
			undefined,
			undefined,
			{},
			{
				modules: [appModule],
				records: project.manifest.modules,
				removedRoots: ["apps/primary"],
			},
		);
	});

	it("protects the actual primary when a secondary is named primary", async () => {
		if (appModule.type !== "app") throw new Error("Expected an app fixture");

		const exit = vi.spyOn(process, "exit").mockImplementation((code) => {
			throw new Error(`exit:${code ?? 0}`);
		});

		lifecycleMocks.loadManagedProject.mockResolvedValue(
			managedProject({
				config: {
					web: "nextjs",
					webApps: [{ name: "primary", framework: "nextjs" }],
				},
				modules: [{ ...appModule, id: "primary", role: "primary" }],
			}),
		);

		try {
			await expect(runRemove("primary", { yes: true })).rejects.toThrow(
				"exit:1",
			);

			expect(promptMocks.logError).toHaveBeenCalledWith(
				"We can't remove the primary web app.",
			);

			expect(lifecycleMocks.applyInstalledPlan).not.toHaveBeenCalled();
		} finally {
			exit.mockRestore();
		}
	});

	it.each(["web", "primary", "apps/web", appModule.id, "nextjs"])(
		"refuses to remove primary web app by %s",
		async (requestedId) => {
			const exit = vi.spyOn(process, "exit").mockImplementation((code) => {
				throw new Error(`exit:${code ?? 0}`);
			});

			try {
				lifecycleMocks.loadManagedProject.mockResolvedValue(
					managedProject({
						config: {
							web: "nextjs",
							webApps: [{ name: "admin", framework: "nextjs" }],
						},
						modules: [appModule, adminModule],
					}),
				);

				await expect(runRemove(requestedId, { yes: true })).rejects.toThrow(
					"exit:1",
				);

				expect(promptMocks.logError).toHaveBeenCalledWith(
					expect.stringContaining("primary web app"),
				);

				expect(lifecycleMocks.applyInstalledPlan).not.toHaveBeenCalled();
			} finally {
				exit.mockRestore();
			}
		},
	);

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
		promptMocks.logInfo.mockReset();
		promptMocks.logSuccess.mockReset();
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
		lifecycleMocks.applyInstalledPlan.mockResolvedValue({
			dependenciesChanged: false,
			declined: [],
			retained: [],
		});
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

	const emailRemovals: ReadonlyArray<{
		readonly authMethods: ReadonlyArray<AuthMethod>;
		readonly message: string;
	}> = [
		{
			authMethods: ["email-password", "magic-link", "email-otp"],
			message:
				"We can't remove email until you remove these sign-in methods: Magic link and Email OTP.",
		},
		{
			authMethods: ["email-otp"],
			message:
				"We can't remove email until you remove this sign-in method: Email OTP.",
		},
	];

	it.each(emailRemovals)(
		"refuses to remove email while $authMethods sign in with it",
		async ({ authMethods, message }) => {
			const exit = vi.spyOn(process, "exit").mockImplementation((code) => {
				throw new Error(`exit:${code ?? 0}`);
			});

			try {
				lifecycleMocks.loadManagedProject.mockResolvedValue(
					managedProject({
						config: {
							authentication: "better-auth",
							authMethods,
							emailProvider: "resend",
							orm: "drizzle",
							slug: "acme",
							web: "nextjs",
						},
						installs: [
							{ definitionId: "better-auth", targets: [{ kind: "project" }] },
							{ definitionId: "drizzle", targets: [{ kind: "project" }] },
							{ definitionId: "email", targets: [{ kind: "project" }] },
						],
					}),
				);

				await expect(runRemove("email", {})).rejects.toThrow("exit:1");

				expect(promptMocks.logError).toHaveBeenCalledWith(message);
				expect(lifecycleMocks.applyInstalledPlan).not.toHaveBeenCalled();
			} finally {
				exit.mockRestore();
			}
		},
	);

	it("removes email once no sign-in method uses it", async () => {
		lifecycleMocks.loadManagedProject.mockResolvedValue(
			managedProject({
				config: {
					authentication: "better-auth",
					authMethods: ["email-password"],
					emailProvider: "resend",
					slug: "acme",
					web: "nextjs",
				},
				installs: [{ definitionId: "email", targets: [{ kind: "project" }] }],
			}),
		);

		await runRemove("email", {});

		expect(promptMocks.logError).not.toHaveBeenCalled();
		expect(lifecycleMocks.applyInstalledPlan).toHaveBeenCalledWith(
			".",
			{
				authentication: "better-auth",
				authMethods: ["email-password"],
				slug: "acme",
				web: "nextjs",
			},
			[],
			undefined,
			undefined,
		);
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
