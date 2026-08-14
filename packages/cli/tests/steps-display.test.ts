import * as generators from "@ryuujs/generators";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { version } from "../package.json" with { type: "json" };
import introStep from "../src/steps/intro";
import outroStep from "../src/steps/outro";
import summaryStep from "../src/steps/summary";
import { SKIP } from "../src/steps/types";

const promptMocks = vi.hoisted(() => ({
	intro: vi.fn<(message: string) => void>(),
	note: vi.fn<(message?: string, title?: string) => void>(),
	outro: vi.fn<(message?: string) => void>(),
}));

vi.mock("@clack/prompts", () => ({
	intro: promptMocks.intro,
	note: promptMocks.note,
	outro: promptMocks.outro,
}));

const ansiPattern = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");

function stripAnsi(text: string): string {
	return text.replace(ansiPattern, "");
}

beforeEach(() => {
	promptMocks.intro.mockReset();
	promptMocks.note.mockReset();
	promptMocks.outro.mockReset();
});

describe("summary step", () => {
	it("skips without a note when non-interactive", async () => {
		await expect(summaryStep.execute({}, false)).resolves.toBe(SKIP);

		expect(promptMocks.note).not.toHaveBeenCalled();
	});

	it("notes the resolved framework, template, and module roots", async () => {
		await expect(
			summaryStep.execute(
				{ path: "./preview", slug: "acme", web: "nextjs" },
				true,
			),
		).resolves.toBe(SKIP);

		expect(promptMocks.note).toHaveBeenCalledTimes(1);

		const [body, title] = promptMocks.note.mock.calls[0] ?? [];

		expect(title).toBe("Forge Plan");
		expect(body).toContain("Framework: Next.js");
		expect(body).toContain("Template: Base");
		expect(body).toContain(
			"Addons: pnpm Workspace, TypeScript, .gitignore, UI Package",
		);
		expect(body).toContain("Modules:");
		expect(body).toContain("apps/web");
	});

	it.each([
		["nextjs", "Next.js"],
		["tanstack-router", "TanStack Router"],
	] as const)(
		"keeps %s as the framework when Hono hosts the backend",
		async (web, framework) => {
			await expect(
				summaryStep.execute(
					{ backend: "hono", path: "./preview", slug: "acme", web },
					true,
				),
			).resolves.toBe(SKIP);

			const [body, title] = promptMocks.note.mock.calls[0] ?? [];
			expect(title).toBe("Forge Plan");
			expect(body).toContain(`Framework: ${framework}`);
			expect(body).toContain("Backend: Hono");
			expect(body).toContain("Template: Base");
		},
	);

	it("falls back to none for an empty config", async () => {
		await expect(summaryStep.execute({}, true)).resolves.toBe(SKIP);

		expect(promptMocks.note).toHaveBeenCalledTimes(1);

		const [body, title] = promptMocks.note.mock.calls[0] ?? [];

		expect(title).toBe("Forge Plan");
		expect(body).toContain("Framework: None");
		expect(body).toContain("Template: None");
		expect(body).toContain("Addons: pnpm Workspace, TypeScript, .gitignore");
		expect(body).not.toContain("Modules:");
	});

	it("keeps the summary usable and exits successfully when planning defects", async () => {
		const defect = new Error("synthetic summary defect");
		const stderr = vi.spyOn(console, "error").mockImplementation(() => {});
		const exit = vi.spyOn(process, "exit");
		const loaded = generators.loadDefinitionRegistry();
		let templateChecks = 0;
		const loadRegistry = vi
			.spyOn(generators, "loadDefinitionRegistry")
			.mockReturnValue({
				...loaded,
				registry: {
					...loaded.registry,
					templates: loaded.registry.templates.map((template) =>
						template.id === "nextjs/base"
							? {
									...template,
									when: (config) => {
										templateChecks += 1;
										if (templateChecks === 1) return template.when(config);
										throw defect;
									},
								}
							: template,
					),
				},
			});

		try {
			await expect(summaryStep.execute({ web: "nextjs" }, true)).resolves.toBe(
				SKIP,
			);

			const [body, title] = promptMocks.note.mock.calls[0] ?? [];
			expect(title).toBe("Forge Plan");
			expect(body).toContain("Framework: Next.js");
			expect(body).not.toContain("Modules:");
			expect(stderr).toHaveBeenCalledTimes(1);
			expect(String(stderr.mock.calls[0]?.[0])).toContain(
				"synthetic summary defect",
			);
			expect(exit).not.toHaveBeenCalled();
		} finally {
			loadRegistry.mockRestore();
			exit.mockRestore();
			stderr.mockRestore();
		}
	});
});

describe("intro step", () => {
	it("prints the banner and starts the forge when interactive", async () => {
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		try {
			await introStep.execute({}, true);

			const logged = logSpy.mock.calls
				.map((call) => call.map(String).join(" "))
				.join("\n");

			expect(stripAnsi(logged)).toContain(`v${version}`);
		} finally {
			logSpy.mockRestore();
		}

		expect(promptMocks.intro).toHaveBeenCalledTimes(1);

		const [message] = promptMocks.intro.mock.calls[0] ?? [];

		expect(stripAnsi(message ?? "")).toBe(" START THE FORGE ");
	});

	it("skips without a banner when non-interactive", async () => {
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		try {
			await expect(introStep.execute({}, false)).resolves.toBe(SKIP);

			expect(logSpy).not.toHaveBeenCalled();
		} finally {
			logSpy.mockRestore();
		}

		expect(promptMocks.intro).not.toHaveBeenCalled();
	});
});

describe("outro step", () => {
	it("celebrates the forged project when interactive", async () => {
		await outroStep.execute({}, true);

		expect(promptMocks.outro).toHaveBeenCalledTimes(1);

		const [message] = promptMocks.outro.mock.calls[0] ?? [];

		expect(stripAnsi(message ?? "")).toBe(
			"You've forged a MYTHIC grade project!",
		);
	});

	it("skips when non-interactive", async () => {
		await expect(outroStep.execute({}, false)).resolves.toBe(SKIP);

		expect(promptMocks.outro).not.toHaveBeenCalled();
	});
});
