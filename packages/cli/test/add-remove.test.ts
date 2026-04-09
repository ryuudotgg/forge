import { beforeEach, describe, expect, it, vi } from "vitest";
import { runAdd } from "../src/commands/add";
import { runRemove } from "../src/commands/remove";

const promptMocks = vi.hoisted(() => ({
	intro: vi.fn(),
	logError: vi.fn(),
	multiselect: vi.fn(),
	select: vi.fn(),
	text: vi.fn(),
}));

const lifecycleMocks = vi.hoisted(() => ({
	applyInstalledPlan: vi.fn(),
	loadManagedProject: vi.fn(),
}));

vi.mock("@clack/prompts", () => ({
	intro: promptMocks.intro,
	isCancel: () => false,
	log: { error: promptMocks.logError },
	multiselect: promptMocks.multiselect,
	select: promptMocks.select,
	text: promptMocks.text,
}));

vi.mock("../src/commands/lifecycle", () => ({
	applyInstalledPlan: lifecycleMocks.applyInstalledPlan,
	loadManagedProject: lifecycleMocks.loadManagedProject,
}));

const appModule = {
	framework: "nextjs" as const,
	id: "abcde",
	packageName: "@acme/web",
	root: "apps/web",
	slots: { layout: "app/layout.tsx" },
	template: { id: "base", version: 1 },
	type: "app" as const,
};

describe("addon lifecycle commands", () => {
	beforeEach(() => {
		lifecycleMocks.applyInstalledPlan.mockReset();
		lifecycleMocks.loadManagedProject.mockReset();
		promptMocks.intro.mockReset();
		promptMocks.logError.mockReset();
		promptMocks.multiselect.mockReset();
		promptMocks.select.mockReset();
		promptMocks.text.mockReset();
	});

	it("searches the curated addon catalog when add is called without an id", async () => {
		lifecycleMocks.loadManagedProject.mockResolvedValue({
			config: { slug: "acme", web: "nextjs" },
			manifest: { config: {}, installs: [], modules: {} },
			modules: [appModule],
			projectRoot: ".",
		});
		promptMocks.text.mockResolvedValue("tailwind");

		await runAdd(undefined, {});

		expect(promptMocks.text).toHaveBeenCalled();
		expect(promptMocks.select).not.toHaveBeenCalled();
		expect(promptMocks.multiselect).not.toHaveBeenCalled();
		expect(lifecycleMocks.applyInstalledPlan).toHaveBeenCalledWith(
			".",
			{ slug: "acme", web: "nextjs" },
			[
				{
					definitionId: "tailwind",
					targets: [{ kind: "module", moduleId: "abcde" }],
				},
			],
		);
	});

	it("prompts from installed addons when remove is called without an id", async () => {
		lifecycleMocks.loadManagedProject.mockResolvedValue({
			config: { slug: "acme", web: "nextjs" },
			manifest: {
				config: {},
				installs: [
					{
						definitionId: "tailwind",
						targets: [{ kind: "module", moduleId: "abcde" }],
					},
				],
				modules: {},
			},
			modules: [appModule],
			projectRoot: ".",
		});
		promptMocks.select.mockResolvedValue("tailwind");

		await runRemove(undefined, {});

		expect(promptMocks.select).toHaveBeenCalled();
		expect(lifecycleMocks.applyInstalledPlan).toHaveBeenCalledWith(
			".",
			{ slug: "acme", web: "nextjs" },
			[],
		);
	});

	it("prompts for module targets only when an addon is installed in multiple modules", async () => {
		const adminModule = {
			...appModule,
			id: "fghij",
			packageName: "@acme/admin",
			root: "apps/admin",
		};

		lifecycleMocks.loadManagedProject.mockResolvedValue({
			config: { slug: "acme", web: "nextjs" },
			manifest: {
				config: {},
				installs: [
					{
						definitionId: "tailwind",
						targets: [
							{ kind: "module", moduleId: "abcde" },
							{ kind: "module", moduleId: "fghij" },
						],
					},
				],
				modules: {},
			},
			modules: [appModule, adminModule],
			projectRoot: ".",
		});
		promptMocks.multiselect.mockResolvedValue(["abcde"]);

		await runRemove("tailwind", {});

		expect(promptMocks.multiselect).toHaveBeenCalled();
		expect(lifecycleMocks.applyInstalledPlan).toHaveBeenCalledWith(
			".",
			{ slug: "acme", web: "nextjs" },
			[
				{
					definitionId: "tailwind",
					targets: [{ kind: "module", moduleId: "fghij" }],
				},
			],
		);
	});
});
