import { beforeEach, describe, expect, it, vi } from "vitest";
import { runRemove } from "../src/commands/remove";
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

describe("remove command", () => {
	beforeEach(() => {
		lifecycleMocks.applyInstalledPlan.mockReset();
		lifecycleMocks.loadManagedProject.mockReset();
		promptMocks.intro.mockReset();
		promptMocks.logError.mockReset();
		promptMocks.multiselect.mockReset();
		promptMocks.select.mockReset();
		promptMocks.text.mockReset();
	});

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

		expect(promptMocks.select).toHaveBeenCalled();
		expect(lifecycleMocks.applyInstalledPlan).toHaveBeenCalledWith(
			".",
			{ slug: "acme", web: "nextjs" },
			[],
		);
	});

	it("prompts for module targets only when an addon is installed in multiple modules", async () => {
		lifecycleMocks.loadManagedProject.mockResolvedValue(
			managedProject({
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
});
