import { beforeEach, describe, expect, it, vi } from "vitest";
import { runUpdate } from "../src/commands/update";
import { managedProject } from "./lifecycle-fixtures";

const promptMocks = vi.hoisted(() => ({
	intro: vi.fn(),
	logInfo: vi.fn(),
}));

const lifecycleMocks = vi.hoisted(() => ({
	applyInstalledPlan: vi.fn(),
	loadManagedProject: vi.fn(),
	loadProjectRegistry: vi.fn(),
}));

vi.mock("@clack/prompts", () => ({
	intro: promptMocks.intro,
	log: { info: promptMocks.logInfo },
}));

vi.mock("../src/commands/lifecycle", () => ({
	applyInstalledPlan: lifecycleMocks.applyInstalledPlan,
	loadManagedProject: lifecycleMocks.loadManagedProject,
	loadProjectRegistry: lifecycleMocks.loadProjectRegistry,
}));

describe("update command", () => {
	beforeEach(() => {
		lifecycleMocks.applyInstalledPlan.mockReset();
		lifecycleMocks.loadManagedProject.mockReset();
		lifecycleMocks.loadProjectRegistry.mockReset();
		promptMocks.intro.mockReset();
		promptMocks.logInfo.mockReset();
		lifecycleMocks.loadProjectRegistry.mockResolvedValue({
			catalog: [],
			descriptors: [],
			registry: { adapters: [], addons: [], frameworks: [], templates: [] },
		});
	});

	it("re-applies the plan with the manifest installs", async () => {
		const project = managedProject({
			installs: [{ definitionId: "tailwind", targets: [{ kind: "project" }] }],
		});
		lifecycleMocks.loadManagedProject.mockResolvedValue(project);

		await runUpdate({});

		expect(lifecycleMocks.loadManagedProject).toHaveBeenCalledWith(
			".",
			"update",
		);
		expect(lifecycleMocks.applyInstalledPlan).toHaveBeenCalledWith(
			".",
			{ slug: "acme", web: "nextjs" },
			[
				{
					definitionId: "tailwind",
					targets: [{ kind: "project" }],
				},
			],
			undefined,
			undefined,
		);

		const [, config, installs] =
			lifecycleMocks.applyInstalledPlan.mock.calls[0] ?? [];
		expect(config).toBe(project.config);
		expect(installs).toBe(project.manifest.installs);
	});

	it("prints the intro before applying the plan", async () => {
		lifecycleMocks.loadManagedProject.mockResolvedValue(managedProject());

		await runUpdate({});

		expect(promptMocks.intro).toHaveBeenCalledTimes(1);
		expect(promptMocks.intro).toHaveBeenCalledWith(
			"We're reconciling your installed addons and templates...",
		);

		const introOrder =
			promptMocks.intro.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY;
		const applyOrder =
			lifecycleMocks.applyInstalledPlan.mock.invocationCallOrder[0] ?? 0;
		expect(introOrder).toBeLessThan(applyOrder);
	});

	it("forwards opted-in registries", async () => {
		lifecycleMocks.loadManagedProject.mockResolvedValue(
			managedProject({ registries: ["@acme/forge-sentry"] }),
		);

		await runUpdate({});

		expect(lifecycleMocks.applyInstalledPlan).toHaveBeenCalledWith(
			".",
			{ slug: "acme", web: "nextjs" },
			[],
			undefined,
			["@acme/forge-sentry"],
		);
	});

	it("forwards the selected conflict resolution policy", async () => {
		lifecycleMocks.loadManagedProject.mockResolvedValue(managedProject());

		await runUpdate({ "keep-user": true });

		expect(lifecycleMocks.applyInstalledPlan).toHaveBeenCalledWith(
			".",
			{ slug: "acme", web: "nextjs" },
			[],
			undefined,
			undefined,
			{ resolutionPolicy: "keep-user" },
		);
	});

	it("reports registry package version changes", async () => {
		lifecycleMocks.loadManagedProject.mockResolvedValue(
			managedProject({
				registries: ["@acme/forge-sentry"],
				registryDescriptors: [
					{
						apiVersion: 1,
						id: "@acme/forge-sentry",
						source: "npm",
						units: [{ id: "@acme/sentry", kind: "addon" }],
						version: "1.4.2",
					},
				],
			}),
		);
		lifecycleMocks.loadProjectRegistry.mockResolvedValue({
			catalog: [],
			descriptors: [
				{
					apiVersion: 1,
					id: "@acme/forge-sentry",
					source: "npm",
					units: [{ id: "@acme/sentry", kind: "addon" }],
					version: "1.5.0",
				},
			],
			registry: { adapters: [], addons: [], frameworks: [], templates: [] },
		});

		await runUpdate({});

		expect(lifecycleMocks.loadProjectRegistry).toHaveBeenCalledWith(".", [
			"@acme/forge-sentry",
		]);
		expect(promptMocks.logInfo).toHaveBeenCalledWith(
			"@acme/forge-sentry 1.4.2 -> 1.5.0.",
		);
	});
});
