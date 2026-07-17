import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	createProject,
	expectInstallAndTypecheck,
	pathExists,
	withScenarioWorkspace,
} from "../utils/harness";

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

			await expectInstallAndTypecheck(workspace, "pnpm");
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

			await expectInstallAndTypecheck(workspace, "pnpm");
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

			await expectInstallAndTypecheck(workspace, "pnpm");
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

			await expectInstallAndTypecheck(workspace, "pnpm");
		});
	}, 600_000);
});
