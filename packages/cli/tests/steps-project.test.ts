import { beforeEach, describe, expect, it, vi } from "vitest";
import catalogsStep from "../src/steps/project/catalogs";
import linterStep from "../src/steps/project/linter";
import nameStep from "../src/steps/project/name";
import packageManagerStep from "../src/steps/project/package-manager";
import pathStep from "../src/steps/project/path";
import runtimeStep from "../src/steps/project/runtime";
import { type PartialConfig, SKIP } from "../src/steps/types";

const promptMocks = vi.hoisted(() => ({
	logError: vi.fn(),
	select: vi.fn(),
	text: vi.fn(),
}));

const coreMocks = vi.hoisted(() => ({
	checkPackageManager: vi.fn(),
}));

vi.mock("@clack/prompts", () => ({
	cancel: vi.fn(),
	isCancel: () => false,
	log: { error: promptMocks.logError },
	select: promptMocks.select,
	text: promptMocks.text,
}));

vi.mock("@ryuujs/core", async (importOriginal) => {
	const original = await importOriginal<typeof import("@ryuujs/core")>();

	return {
		...original,
		checkPackageManager: coreMocks.checkPackageManager,
	};
});

function rawConfig(values: Record<string, unknown>): PartialConfig {
	const config: PartialConfig = {};
	for (const [key, value] of Object.entries(values)) config[key] = value;

	return config;
}

interface TextPromptOptions {
	defaultValue?: string;
	validate?: (value: string) => string | undefined;
}

describe("project steps", () => {
	beforeEach(() => {
		coreMocks.checkPackageManager.mockReset();
		promptMocks.logError.mockReset();
		promptMocks.select.mockReset();
		promptMocks.text.mockReset();
	});

	describe("package manager", () => {
		it("uses the configured package manager without prompting", async () => {
			await expect(
				packageManagerStep.execute({ packageManager: "npm" }, false),
			).resolves.toBe("npm");

			expect(promptMocks.select).not.toHaveBeenCalled();
		});

		it("defaults to Bun when the runtime is Bun", async () => {
			await expect(
				packageManagerStep.execute({ runtime: "Bun" }, false),
			).resolves.toBe("Bun");
		});

		it("defaults to pnpm for every other runtime", async () => {
			await expect(
				packageManagerStep.execute({ runtime: "Deno" }, false),
			).resolves.toBe("pnpm");
			await expect(packageManagerStep.execute({}, false)).resolves.toBe("pnpm");
		});

		it("silently falls back to the smart default for an invalid package manager", async () => {
			await expect(
				packageManagerStep.execute(
					rawConfig({ packageManager: "yarn-classic" }),
					false,
				),
			).resolves.toBe("pnpm");
		});

		it("marks the smart default as recommended and returns the selection", async () => {
			promptMocks.select.mockResolvedValue("Bun");
			coreMocks.checkPackageManager.mockReturnValue({
				message: "Bun v1.2.19",
				ok: true,
			});

			await expect(
				packageManagerStep.execute({ runtime: "Node.js" }, true),
			).resolves.toBe("Bun");

			expect(promptMocks.select).toHaveBeenCalledWith(
				expect.objectContaining({
					options: [
						{ label: "pnpm (Recommended)", value: "pnpm" },
						{ label: "npm", value: "npm" },
						{ label: "Yarn", value: "Yarn" },
						{ label: "Bun", value: "Bun" },
					],
				}),
			);
			expect(coreMocks.checkPackageManager).toHaveBeenCalledWith("Bun");
		});

		it("exits when the selected package manager is unusable", async () => {
			const exit = vi.spyOn(process, "exit").mockImplementation(((
				code?: string | number | null,
			) => {
				throw new Error(`exit:${code ?? 0}`);
			}) as never);

			try {
				promptMocks.select.mockResolvedValue("pnpm");
				coreMocks.checkPackageManager.mockReturnValue({
					message:
						"You don't have pnpm installed, please install it and try again.",
					ok: false,
				});

				await expect(packageManagerStep.execute({}, true)).rejects.toThrow(
					"exit:1",
				);

				expect(promptMocks.logError).toHaveBeenCalledWith(
					"You don't have pnpm installed, please install it and try again.",
				);
			} finally {
				exit.mockRestore();
			}
		});
	});

	describe("name", () => {
		it("uses the configured name and slug without prompting", async () => {
			await expect(
				nameStep.execute({ name: "Acme", slug: "acme" }, false),
			).resolves.toEqual({ name: "Acme", slug: "acme" });

			expect(promptMocks.text).not.toHaveBeenCalled();
		});

		it("derives the slug from the configured name", async () => {
			await expect(
				nameStep.execute({ name: "My App" }, false),
			).resolves.toEqual({ name: "My App", slug: "my-app" });
		});

		it("skips when the configured name is invalid and prompts are unavailable", async () => {
			await expect(
				nameStep.execute({ name: "a".repeat(16) }, false),
			).resolves.toBe(SKIP);
		});

		it("validates names and derived slugs in the prompt", async () => {
			let validate: TextPromptOptions["validate"];
			promptMocks.text.mockImplementation((options: TextPromptOptions) => {
				validate = options.validate;
				return Promise.resolve("Acme");
			});

			await expect(nameStep.execute({}, true)).resolves.toEqual({
				name: "Acme",
				slug: "acme",
			});

			expect(validate?.("")).toBe("You need to provide a name.");
			expect(validate?.("a".repeat(16))).toBe(
				"It must be less than 15 characters.",
			);
			expect(validate?.("!!!")).toBe("We couldn't generate a slug.");
			expect(validate?.("Acme")).toBeUndefined();
		});
	});

	describe("path", () => {
		it("defaults to the slug directory when no path is configured", async () => {
			await expect(pathStep.execute({ slug: "acme" }, false)).resolves.toBe(
				"./acme",
			);
		});

		it("keeps a configured relative path", async () => {
			await expect(pathStep.execute({ path: "./custom" }, false)).resolves.toBe(
				"./custom",
			);
			await expect(pathStep.execute({ path: "." }, false)).resolves.toBe(".");
		});

		it("skips when the configured path is not relative", async () => {
			await expect(
				pathStep.execute({ path: "/abs/path" }, false),
			).resolves.toBe(SKIP);
		});

		it("prompts with the slug default and validates relative paths", async () => {
			let captured: TextPromptOptions | undefined;
			promptMocks.text.mockImplementation((options: TextPromptOptions) => {
				captured = options;
				return Promise.resolve("./somewhere");
			});

			await expect(pathStep.execute({ slug: "acme" }, true)).resolves.toBe(
				"./somewhere",
			);

			expect(captured?.defaultValue).toBe("./acme");
			expect(captured?.validate?.("")).toBeUndefined();
			expect(captured?.validate?.("/abs")).toBe(
				"You need to provide a relative path.",
			);
		});
	});

	describe("runtime", () => {
		it("uses the configured runtime without prompting", async () => {
			await expect(
				runtimeStep.execute({ runtime: "Bun" }, false),
			).resolves.toBe("Bun");

			expect(promptMocks.select).not.toHaveBeenCalled();
		});

		it("defaults to Node.js when the runtime is missing or invalid", async () => {
			await expect(runtimeStep.execute({}, false)).resolves.toBe("Node.js");
			await expect(
				runtimeStep.execute(rawConfig({ runtime: "node18" }), false),
			).resolves.toBe("Node.js");
		});

		it("marks Node.js as recommended and returns the selection", async () => {
			promptMocks.select.mockResolvedValue("Deno");

			await expect(runtimeStep.execute({}, true)).resolves.toBe("Deno");

			expect(promptMocks.select).toHaveBeenCalledWith(
				expect.objectContaining({
					options: [
						{ label: "Node.js (Recommended)", value: "Node.js" },
						{ label: "Bun", value: "Bun" },
						{ label: "Deno", value: "Deno" },
					],
				}),
			);
		});
	});

	describe("linter", () => {
		it("uses the configured linter without prompting", async () => {
			await expect(
				linterStep.execute({ linter: "biome" }, false),
			).resolves.toBe("biome");

			expect(promptMocks.select).not.toHaveBeenCalled();
		});

		it("normalizes display-name aliases", async () => {
			await expect(
				linterStep.execute(rawConfig({ linter: "Biome" }), false),
			).resolves.toBe("biome");
		});

		it("skips when the linter is missing or unknown", async () => {
			await expect(linterStep.execute({}, false)).resolves.toBe(SKIP);
			await expect(
				linterStep.execute(rawConfig({ linter: "tslint" }), false),
			).resolves.toBe(SKIP);
		});

		it("returns the selected linter", async () => {
			promptMocks.select.mockResolvedValue("biome");

			await expect(linterStep.execute({}, true)).resolves.toBe("biome");

			expect(promptMocks.select).toHaveBeenCalledWith(
				expect.objectContaining({
					options: [
						{ label: "Biome", value: "biome" },
						{ label: "Oxc", value: "oxc" },
						{ label: "ESLint + Prettier", value: "eslint-prettier" },
						{ label: "None", value: "none" },
					],
				}),
			);
		});

		it("skips when None is selected", async () => {
			promptMocks.select.mockResolvedValue("none");

			await expect(linterStep.execute({}, true)).resolves.toBe(SKIP);
		});
	});

	describe("catalogs", () => {
		it("only runs for pnpm projects", () => {
			expect(catalogsStep.shouldRun({ packageManager: "pnpm" })).toBe(true);
			expect(catalogsStep.shouldRun({ packageManager: "npm" })).toBe(false);
			expect(catalogsStep.shouldRun({})).toBe(false);
		});

		it("always skips without prompts", async () => {
			await expect(
				catalogsStep.execute(
					{ catalogs: "flat", packageManager: "pnpm" },
					false,
				),
			).resolves.toBe(SKIP);

			expect(promptMocks.select).not.toHaveBeenCalled();
		});

		it("returns the selected catalog mode with hints", async () => {
			promptMocks.select.mockResolvedValue("scoped");

			await expect(catalogsStep.execute({}, true)).resolves.toBe("scoped");

			expect(promptMocks.select).toHaveBeenCalledWith(
				expect.objectContaining({
					options: [
						{
							hint: "single shared catalog for all deps",
							label: "Flat",
							value: "flat",
						},
						{
							hint: "grouped catalogs (catalog:dev, catalog:lint, ...)",
							label: "Scoped",
							value: "scoped",
						},
						{
							hint: "no catalogs, inline version strings",
							label: "None",
							value: "none",
						},
					],
				}),
			);
		});

		it("skips when None is selected", async () => {
			promptMocks.select.mockResolvedValue("none");

			await expect(catalogsStep.execute({}, true)).resolves.toBe(SKIP);
		});
	});
});
