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
