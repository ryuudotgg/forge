import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { runCreate } from "../src/commands/create";
import { defaultPreset } from "../src/presets/default";
import { steps } from "../src/steps";

const promptMocks = vi.hoisted(() => ({
	logError: vi.fn(),
}));

const orchestratorMocks = vi.hoisted(() => ({
	orchestrate: vi.fn(),
}));

vi.mock("@clack/prompts", () => ({
	log: { error: promptMocks.logError },
}));

vi.mock("../src/orchestrator", () => ({
	orchestrate: orchestratorMocks.orchestrate,
}));

async function withTempDir<T>(
	name: string,
	run: (directory: string) => Promise<T>,
) {
	const directory = await mkdtemp(join(tmpdir(), `forge-${name}-`));

	try {
		return await run(directory);
	} finally {
		await rm(directory, { force: true, recursive: true });
	}
}

describe("create command", () => {
	beforeEach(() => {
		orchestratorMocks.orchestrate.mockReset();
		promptMocks.logError.mockReset();
	});

	it("merges presets, config files, and flag overrides before orchestration", async () => {
		await withTempDir("create-test", async (directory) => {
			const configPath = join(directory, "forge.config.json");

			await writeFile(
				configPath,
				JSON.stringify({
					name: "From Config",
					path: "./from-config",
					web: "tanstack-router",
				}),
				"utf-8",
			);

			await runCreate({
				config: configPath,
				name: "From Flag",
				"no-git": true,
				"no-install": true,
				preset: "default",
				runtime: "Bun",
			});

			expect(orchestratorMocks.orchestrate).toHaveBeenCalledWith(steps, {
				initialConfig: {
					...defaultPreset,
					gitInit: false,
					installDeps: false,
					name: "From Flag",
					path: "./from-config",
					runtime: "Bun",
					web: "tanstack-router",
				},
				interactive: false,
			});
		});
	});

	it("passes the preset through untouched and stays interactive without a config file", async () => {
		await runCreate({ preset: "default" });

		expect(orchestratorMocks.orchestrate).toHaveBeenCalledWith(steps, {
			initialConfig: { ...defaultPreset },
			interactive: true,
		});
	});

	it("keeps gitInit and installDeps from the config file when the flags are absent", async () => {
		await withTempDir("create-test", async (directory) => {
			const configPath = join(directory, "forge.config.json");

			await writeFile(
				configPath,
				JSON.stringify({ gitInit: true, installDeps: true }),
				"utf-8",
			);

			await runCreate({ config: configPath });

			expect(orchestratorMocks.orchestrate).toHaveBeenCalledWith(steps, {
				initialConfig: { gitInit: true, installDeps: true },
				interactive: false,
			});
		});
	});

	it("logs a helpful error when the preset is unknown", async () => {
		const exit = vi.spyOn(process, "exit").mockImplementation(((
			code?: string | number | null,
		) => {
			throw new Error(`exit:${code ?? 0}`);
		}) as never);

		try {
			await expect(runCreate({ preset: "unknown" })).rejects.toThrow("exit:1");

			expect(promptMocks.logError).toHaveBeenCalledWith(
				"We couldn't find this preset. You can use: default.",
			);
			expect(orchestratorMocks.orchestrate).not.toHaveBeenCalled();
		} finally {
			exit.mockRestore();
		}
	});

	it("logs a helpful error when the config file cannot be parsed", async () => {
		await withTempDir("create-test", async (directory) => {
			const configPath = join(directory, "broken.json");
			const exit = vi.spyOn(process, "exit").mockImplementation(((
				code?: string | number | null,
			) => {
				throw new Error(`exit:${code ?? 0}`);
			}) as never);

			try {
				await writeFile(configPath, "{invalid-json", "utf-8");

				await expect(runCreate({ config: configPath })).rejects.toThrow(
					"exit:1",
				);

				expect(promptMocks.logError).toHaveBeenCalledWith(
					`We couldn't read or parse the config file at "${configPath}".`,
				);
				expect(orchestratorMocks.orchestrate).not.toHaveBeenCalled();
			} finally {
				exit.mockRestore();
			}
		});
	});

	it("logs a helpful error when the config file does not exist", async () => {
		await withTempDir("create-test", async (directory) => {
			const configPath = join(directory, "missing.json");
			const exit = vi.spyOn(process, "exit").mockImplementation(((
				code?: string | number | null,
			) => {
				throw new Error(`exit:${code ?? 0}`);
			}) as never);

			try {
				await expect(runCreate({ config: configPath })).rejects.toThrow(
					"exit:1",
				);

				expect(promptMocks.logError).toHaveBeenCalledWith(
					`We couldn't read or parse the config file at "${configPath}".`,
				);
				expect(orchestratorMocks.orchestrate).not.toHaveBeenCalled();
			} finally {
				exit.mockRestore();
			}
		});
	});

	it("rejects config files that parse but are not a record", async () => {
		await withTempDir("create-test", async (directory) => {
			const configPath = join(directory, "invalid.json");
			const exit = vi.spyOn(process, "exit").mockImplementation(((
				code?: string | number | null,
			) => {
				throw new Error(`exit:${code ?? 0}`);
			}) as never);

			try {
				await writeFile(configPath, "[1,2]", "utf-8");

				await expect(runCreate({ config: configPath })).rejects.toThrow(
					"exit:1",
				);

				expect(promptMocks.logError).toHaveBeenCalledWith(
					"Your config file is invalid.\n  Expected { readonly [x: string]: unknown }, actual [1,2]",
				);
				expect(orchestratorMocks.orchestrate).not.toHaveBeenCalled();
			} finally {
				exit.mockRestore();
			}
		});
	});
});
