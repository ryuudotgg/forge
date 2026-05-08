import { beforeEach, describe, expect, it, vi } from "vitest";
import { runAdd } from "../src/commands/add";
import { adminModule, appModule, managedProject } from "./lifecycle-fixtures";

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

describe("add command", () => {
	beforeEach(() => {
		lifecycleMocks.applyInstalledPlan.mockReset();
		lifecycleMocks.loadManagedProject.mockReset();
		promptMocks.intro.mockReset();
		promptMocks.logError.mockReset();
		promptMocks.multiselect.mockReset();
		promptMocks.select.mockReset();
		promptMocks.text.mockReset();
	});

	it("searches the curated addon catalog when called without an id", async () => {
		lifecycleMocks.loadManagedProject.mockResolvedValue(managedProject());
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

	it("prompts with a single select when multiple compatible module targets exist", async () => {
		lifecycleMocks.loadManagedProject.mockResolvedValue(
			managedProject({ modules: [appModule, adminModule] }),
		);

		promptMocks.select.mockResolvedValue("fghij");

		await runAdd("tailwind", {});

		expect(promptMocks.select).toHaveBeenCalled();
		expect(promptMocks.multiselect).not.toHaveBeenCalled();
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
});
