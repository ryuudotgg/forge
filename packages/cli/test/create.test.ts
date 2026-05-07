import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { runCreate } from "../src/commands/create";

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
					web: "nextjs",
				}),
				"utf-8",
			);

			await runCreate({
				config: configPath,
				name: "From Flag",
				"no-git": true,
				"no-install": true,
				preset: "api-only",
				runtime: "Node.js",
			});

			expect(orchestratorMocks.orchestrate).toHaveBeenCalledWith(
				expect.any(Array),
				expect.objectContaining({
					interactive: false,
					initialConfig: expect.objectContaining({
						name: "From Flag",
						gitInit: false,
						installDeps: false,
						path: "./from-config",
						runtime: "Node.js",
						web: "nextjs",
					}),
				}),
			);
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
				expect.stringContaining("We couldn't find this preset."),
			);
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
			} finally {
				exit.mockRestore();
			}
		});
	});
});
