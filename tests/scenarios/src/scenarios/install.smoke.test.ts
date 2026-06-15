import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	createProject,
	forgeEnvironment,
	pathExists,
	runCommand,
	type ScenarioProject,
	withScenarioWorkspace,
} from "../utils/harness";

async function expectTypecheckPasses(workspace: ScenarioProject) {
	const installResult = await runCommand("pnpm", ["install"], {
		cwd: workspace.projectRoot,
		env: forgeEnvironment(workspace.workspaceRoot),
	});

	expect(
		installResult.exitCode,
		`pnpm install failed with code ${installResult.exitCode}\n${installResult.stdout}\n${installResult.stderr}`,
	).toBe(0);

	const result = await runCommand("pnpm", ["typecheck"], {
		cwd: workspace.projectRoot,
		env: forgeEnvironment(workspace.workspaceRoot),
	});

	expect(
		result.exitCode,
		`pnpm typecheck failed with code ${result.exitCode}\n${result.stdout}\n${result.stderr}`,
	).toBe(0);
}

describe.runIf(process.env.FORGE_SMOKE === "1")("install smoke", () => {
	it("installs a prisma project, generates the client, and typechecks", async () => {
		await withScenarioWorkspace("smoke-prisma", async (workspace) => {
			await createProject(
				workspace,
				{
					authentication: "better-auth",
					database: "postgresql",
					linter: "biome",
					orm: "prisma",
					packageManager: "pnpm",
					style: "tailwind",
					web: "nextjs",
				},
				{ install: true },
			);

			expect(
				await pathExists(
					join(workspace.projectRoot, "packages/db/src/generated/prisma"),
				),
			).toBe(true);

			await expectTypecheckPasses(workspace);
		});
	}, 600_000);

	it("installs and typechecks a drizzle project with trpc and tailwind", async () => {
		await withScenarioWorkspace("smoke-drizzle", async (workspace) => {
			await createProject(
				workspace,
				{
					authentication: "better-auth",
					database: "postgresql",
					linter: "biome",
					orm: "drizzle",
					packageManager: "pnpm",
					rpc: "trpc",
					style: "tailwind",
					web: "nextjs",
				},
				{ install: true },
			);

			await expectTypecheckPasses(workspace);
		});
	}, 600_000);

	it("installs and typechecks a drizzle mysql project", async () => {
		await withScenarioWorkspace("smoke-drizzle-mysql", async (workspace) => {
			await createProject(
				workspace,
				{
					authentication: "better-auth",
					database: "mysql",
					linter: "biome",
					orm: "drizzle",
					packageManager: "pnpm",
					rpc: "trpc",
					style: "tailwind",
					web: "nextjs",
				},
				{ install: true },
			);

			await expectTypecheckPasses(workspace);
		});
	}, 600_000);

	it("installs and typechecks a drizzle sqlite project", async () => {
		await withScenarioWorkspace("smoke-drizzle-sqlite", async (workspace) => {
			await createProject(
				workspace,
				{
					authentication: "better-auth",
					database: "sqlite",
					linter: "biome",
					orm: "drizzle",
					packageManager: "pnpm",
					rpc: "trpc",
					style: "tailwind",
					web: "nextjs",
				},
				{ install: true },
			);

			await expectTypecheckPasses(workspace);
		});
	}, 600_000);
});
