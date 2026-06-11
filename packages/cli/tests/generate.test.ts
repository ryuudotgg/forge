import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import generateStep from "../src/steps/generate";
import { SKIP } from "../src/steps/types";

const promptMocks = vi.hoisted(() => ({
	logError: vi.fn(),
}));

vi.mock("@clack/prompts", () => ({
	log: { error: promptMocks.logError },
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

async function readJson(path: string): Promise<unknown> {
	return JSON.parse(await readFile(path, "utf-8"));
}

describe("generate step", () => {
	beforeEach(() => {
		promptMocks.logError.mockReset();
	});

	it("writes the planned project to disk and returns SKIP", async () => {
		await withTempDir("generate-test", async (directory) => {
			const result = await generateStep.execute(
				{
					name: "Acme",
					slug: "acme",
					path: directory,
					web: "nextjs",
					packageManager: "pnpm",
					runtime: "Node.js",
				},
				false,
			);

			expect(result).toBe(SKIP);

			const workspacePackage = await readJson(join(directory, "package.json"));
			expect(workspacePackage).toMatchObject({ name: "acme" });

			const manifest = await readJson(
				join(directory, ".forge", "manifest.json"),
			);

			expect(manifest).toMatchObject({
				config: expect.objectContaining({ slug: "acme" }),
			});
		});
	}, 120_000);

	it("requires an orm before generating with better auth", async () => {
		const exit = vi.spyOn(process, "exit").mockImplementation(((
			code?: string | number | null,
		) => {
			throw new Error(`exit:${code ?? 0}`);
		}) as never);

		try {
			await withTempDir("generate-test", async (directory) => {
				await expect(
					generateStep.execute(
						{ authentication: "better-auth", path: directory },
						false,
					),
				).rejects.toThrow("exit:1");

				expect(promptMocks.logError).toHaveBeenCalledWith(
					"You need to add an ORM before you can use Better Auth.",
				);
			});
		} finally {
			exit.mockRestore();
		}
	});

	it("wraps planner and apply failures as a generation failure", async () => {
		await withTempDir("generate-test", async (directory) => {
			const blocked = join(directory, "blocked");
			await writeFile(blocked, "not a directory", "utf-8");

			await expect(
				generateStep.execute(
					{
						name: "Acme",
						slug: "acme",
						path: blocked,
						web: "nextjs",
						packageManager: "pnpm",
						runtime: "Node.js",
					},
					false,
				),
			).rejects.toThrow(/^Generation Failed: /);
		});
	}, 120_000);
});
