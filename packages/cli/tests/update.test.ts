import { beforeEach, describe, expect, it, vi } from "vitest";
import { runUpdate } from "../src/commands/update";
import { managedProject } from "./lifecycle-fixtures";

const promptMocks = vi.hoisted(() => ({
	intro: vi.fn(),
}));

const lifecycleMocks = vi.hoisted(() => ({
	applyInstalledPlan: vi.fn(),
	loadManagedProject: vi.fn(),
}));

vi.mock("@clack/prompts", () => ({
	intro: promptMocks.intro,
}));

vi.mock("../src/commands/lifecycle", () => ({
	applyInstalledPlan: lifecycleMocks.applyInstalledPlan,
	loadManagedProject: lifecycleMocks.loadManagedProject,
}));

describe("update command", () => {
	beforeEach(() => {
		lifecycleMocks.applyInstalledPlan.mockReset();
		lifecycleMocks.loadManagedProject.mockReset();
		promptMocks.intro.mockReset();
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
});
