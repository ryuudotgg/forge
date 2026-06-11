import { beforeEach, describe, expect, it, vi } from "vitest";
import addonsStep from "../src/steps/addons/select";
import { type PartialConfig, SKIP } from "../src/steps/types";

const promptMocks = vi.hoisted(() => ({
	multiselect: vi.fn(),
}));

const catalogMocks = vi.hoisted(() => ({
	getCatalogEntry: vi.fn(),
}));

vi.mock("@clack/prompts", () => ({
	isCancel: () => false,
	multiselect: promptMocks.multiselect,
}));

vi.mock("@ryuujs/generators", async (importOriginal) => {
	const original = await importOriginal<typeof import("@ryuujs/generators")>();

	return {
		...original,
		getCatalogEntry: catalogMocks.getCatalogEntry,
	};
});

const generators =
	await vi.importActual<typeof import("@ryuujs/generators")>(
		"@ryuujs/generators",
	);

function rawConfig(entries: Record<string, unknown>): PartialConfig {
	const config: PartialConfig = {};

	for (const [key, value] of Object.entries(entries)) config[key] = value;

	return config;
}

beforeEach(() => {
	promptMocks.multiselect.mockReset();
	catalogMocks.getCatalogEntry.mockReset();
	catalogMocks.getCatalogEntry.mockImplementation(generators.getCatalogEntry);
});

describe("addons step", () => {
	it("keeps a valid addon list when non-interactive", async () => {
		await expect(
			addonsStep.execute({ addons: ["lefthook", "vscode"] }, false),
		).resolves.toEqual(["lefthook", "vscode"]);
	});

	it("keeps an empty addon list when non-interactive", async () => {
		await expect(addonsStep.execute({ addons: [] }, false)).resolves.toEqual(
			[],
		);
	});

	it("silently filters unknown addons when non-interactive", async () => {
		await expect(
			addonsStep.execute(rawConfig({ addons: ["lefthook", "bogus"] }), false),
		).resolves.toEqual(["lefthook"]);
	});

	it("skips when addons is not an array", async () => {
		await expect(
			addonsStep.execute(rawConfig({ addons: "lefthook" }), false),
		).resolves.toBe(SKIP);
	});

	it("preselects the recommended addons and returns the interactive choice", async () => {
		promptMocks.multiselect.mockResolvedValue(["commitlint"]);

		await expect(addonsStep.execute({}, true)).resolves.toEqual(["commitlint"]);

		expect(promptMocks.multiselect).toHaveBeenCalledWith({
			initialValues: ["commitlint", "github-ci", "lefthook", "vscode"],
			message: "Which addons do you want to include?",
			options: [
				{
					hint: "Enforce conventional commits.",
					label: "commitlint",
					value: "commitlint",
				},
				{
					hint: "Add GitHub Actions CI.",
					label: "GitHub CI",
					value: "github-ci",
				},
				{
					hint: "Add lefthook git hooks.",
					label: "Lefthook",
					value: "lefthook",
				},
				{
					hint: "Create a shared utilities package.",
					label: "Shared Package",
					value: "shared",
				},
				{
					hint: "Configure VS Code workspace.",
					label: "VS Code",
					value: "vscode",
				},
			],
			required: false,
		});
	});

	it("hides hidden catalog entries from the options and preselection", async () => {
		catalogMocks.getCatalogEntry.mockImplementation((id: string) => {
			const entry = generators.getCatalogEntry(id);
			if (entry === undefined || id !== "lefthook") return entry;

			return { ...entry, hidden: true };
		});
		promptMocks.multiselect.mockResolvedValue([]);

		await expect(addonsStep.execute({}, true)).resolves.toEqual([]);

		expect(promptMocks.multiselect).toHaveBeenCalledWith(
			expect.objectContaining({
				initialValues: ["commitlint", "github-ci", "vscode"],
				options: [
					expect.objectContaining({ value: "commitlint" }),
					expect.objectContaining({ value: "github-ci" }),
					expect.objectContaining({ value: "shared" }),
					expect.objectContaining({ value: "vscode" }),
				],
			}),
		);
	});

	it("skips without prompting when no catalog entry is available", async () => {
		catalogMocks.getCatalogEntry.mockReturnValue(undefined);

		await expect(addonsStep.execute({}, true)).resolves.toBe(SKIP);

		expect(promptMocks.multiselect).not.toHaveBeenCalled();
	});
});
