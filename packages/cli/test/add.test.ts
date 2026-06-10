import { beforeEach, describe, expect, it, vi } from "vitest";
import { runAdd } from "../src/commands/add";
import {
	adminModule,
	appModule,
	managedProject,
	reactRouterModule,
} from "./lifecycle-fixtures";

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
			return original.loadAddonDefinition(id);
		},
	};
});

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
			{ slug: "acme", style: "tailwind", web: "nextjs" },
			[
				{
					definitionId: "tailwind",
					targets: [{ kind: "project" }],
				},
			],
		);
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
			[
				{
					definitionId: "tailwind",
					targets: [{ kind: "project" }],
				},
			],
		);
	});

	it("sets the mapped config field when adding an orm", async () => {
		lifecycleMocks.loadManagedProject.mockResolvedValue(managedProject());

		await runAdd("prisma", {});

		expect(lifecycleMocks.applyInstalledPlan).toHaveBeenCalledWith(
			".",
			{ orm: "prisma", slug: "acme", web: "nextjs" },
			[
				{
					definitionId: "prisma",
					targets: [{ kind: "project" }],
				},
			],
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

	it("records opt-in addons on the config so contributions stay in sync", async () => {
		lifecycleMocks.loadManagedProject.mockResolvedValue(
			managedProject({ config: { addons: ["lefthook"], slug: "acme" } }),
		);

		await runAdd("commitlint", {});

		expect(lifecycleMocks.applyInstalledPlan).toHaveBeenCalledWith(
			".",
			{ addons: ["lefthook", "commitlint"], slug: "acme" },
			[
				{
					definitionId: "commitlint",
					targets: [{ kind: "project" }],
				},
			],
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
		);
	});

	it("prompts for a single module when multiple targets are compatible", async () => {
		lifecycleMocks.loadManagedProject.mockResolvedValue(
			managedProject({ modules: [appModule, adminModule] }),
		);
		promptMocks.select.mockResolvedValue(adminModule.id);

		await runAdd("mock-single", {});

		expect(promptMocks.select).toHaveBeenCalledWith(
			expect.objectContaining({
				options: [
					expect.objectContaining({ value: appModule.id }),
					expect.objectContaining({ value: adminModule.id }),
				],
			}),
		);
		expect(promptMocks.multiselect).not.toHaveBeenCalled();
		expect(lifecycleMocks.applyInstalledPlan).toHaveBeenCalledWith(
			".",
			{ slug: "acme", web: "nextjs" },
			[
				{
					definitionId: "mock-single",
					targets: [{ kind: "module", moduleId: adminModule.id }],
				},
			],
		);
	});

	it("multi-selects modules for addons that support multiple targets", async () => {
		lifecycleMocks.loadManagedProject.mockResolvedValue(
			managedProject({ modules: [appModule, adminModule] }),
		);
		promptMocks.multiselect.mockResolvedValue([appModule.id, adminModule.id]);

		await runAdd("mock-multi", {});

		expect(promptMocks.select).not.toHaveBeenCalled();
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
		);
	});

	it("merges new module targets into an existing multi-target install", async () => {
		lifecycleMocks.loadManagedProject.mockResolvedValue(
			managedProject({
				installs: [
					{
						definitionId: "mock-multi",
						targets: [{ kind: "module", moduleId: appModule.id }],
					},
				],
				modules: [appModule, adminModule],
			}),
		);
		promptMocks.multiselect.mockResolvedValue([adminModule.id]);

		await runAdd("mock-multi", {});

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
