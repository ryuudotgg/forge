import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	createProject,
	expectInstallAndTypecheck,
	pathExists,
	withScenarioWorkspace,
} from "../utils/harness";
import {
	authPluginConfig,
	createSmokeDatabase,
	expectPasskeyInstallAndTypecheck,
	expectSchemaPush,
	mysqlDatabaseEnv,
	postgresDatabaseEnv,
	postgresProviderCells,
	runTransactionProbe,
	runUserDeleteProbe,
	smokeDatabaseOn,
	smokeDatabaseUrl,
	smokeMysqlUrl,
	transactionProbeSource,
} from "../utils/install-smoke";

describe.runIf(process.env.FORGE_SMOKE === "1")("install smoke", () => {
	it("installs a prisma project, generates the client, typechecks, and pushes", async () => {
		await withScenarioWorkspace("smoke-prisma", async (workspace) => {
			await createProject(
				workspace,
				{
					...authPluginConfig,
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

			await expectPasskeyInstallAndTypecheck(workspace);
			await expectSchemaPush(
				workspace.projectRoot,
				postgresDatabaseEnv("forge_smoke_prisma"),
			);
		});
	}, 600_000);

	it("installs, typechecks, and pushes a drizzle project with trpc and tailwind", async () => {
		await withScenarioWorkspace("smoke-drizzle", async (workspace) => {
			await createProject(
				workspace,
				{
					...authPluginConfig,
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

			await expectPasskeyInstallAndTypecheck(workspace);
			await createSmokeDatabase(
				workspace.projectRoot,
				"pg",
				"forge_smoke_drizzle",
			);

			await expectSchemaPush(
				workspace.projectRoot,
				postgresDatabaseEnv("forge_smoke_drizzle"),
			);
		});
	}, 600_000);

	it("installs, typechecks, and pushes a drizzle mysql project", async () => {
		await withScenarioWorkspace("smoke-drizzle-mysql", async (workspace) => {
			await createProject(
				workspace,
				{
					...authPluginConfig,
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

			await expectPasskeyInstallAndTypecheck(workspace);
			await createSmokeDatabase(
				workspace.projectRoot,
				"mysql2",
				"forge_smoke_drizzle_mysql",
			);

			await expectSchemaPush(
				workspace.projectRoot,
				mysqlDatabaseEnv("forge_smoke_drizzle_mysql"),
			);
		});
	}, 600_000);

	it("installs, typechecks, and pushes a drizzle planetscale mysql project", async () => {
		await withScenarioWorkspace(
			"smoke-drizzle-planetscale-mysql",
			async (workspace) => {
				await createProject(
					workspace,
					{
						...authPluginConfig,
						authentication: "better-auth",
						database: "mysql",
						databaseProvider: "planetscale",
						linter: "biome",
						orm: "drizzle",
						packageManager: "pnpm",
						style: "tailwind",
						web: "nextjs",
					},
					{ install: true },
				);

				await expectPasskeyInstallAndTypecheck(workspace);
				await createSmokeDatabase(
					workspace.projectRoot,
					"mysql2",
					"forge_smoke_drizzle_planetscale",
				);

				await expectSchemaPush(
					workspace.projectRoot,
					mysqlDatabaseEnv("forge_smoke_drizzle_planetscale"),
				);

				const probe = await runUserDeleteProbe(
					workspace,
					smokeDatabaseOn(smokeMysqlUrl(), "forge_smoke_drizzle_planetscale"),
				);

				expect(probe.exitCode, `${probe.stdout}\n${probe.stderr}`).toBe(0);
			},
		);
	}, 600_000);

	it("installs, typechecks, and pushes a prisma mysql project", async () => {
		await withScenarioWorkspace("smoke-prisma-mysql", async (workspace) => {
			await createProject(
				workspace,
				{
					...authPluginConfig,
					authentication: "better-auth",
					database: "mysql",
					linter: "biome",
					orm: "prisma",
					packageManager: "pnpm",
					style: "tailwind",
					web: "nextjs",
				},
				{ install: true },
			);

			await expectPasskeyInstallAndTypecheck(workspace);
			await expectSchemaPush(
				workspace.projectRoot,
				mysqlDatabaseEnv("forge_smoke_prisma_mysql"),
			);
		});
	}, 600_000);

	it("installs, typechecks, and pushes a prisma sqlite project", async () => {
		await withScenarioWorkspace("smoke-prisma-sqlite", async (workspace) => {
			await createProject(
				workspace,
				{
					...authPluginConfig,
					authentication: "better-auth",
					database: "sqlite",
					linter: "biome",
					orm: "prisma",
					packageManager: "pnpm",
					style: "tailwind",
					web: "nextjs",
				},
				{ install: true },
			);

			await expectPasskeyInstallAndTypecheck(workspace);
			await expectSchemaPush(workspace.projectRoot);
		});
	}, 600_000);

	it("installs, typechecks, and pushes a drizzle sqlite project", async () => {
		await withScenarioWorkspace("smoke-drizzle-sqlite", async (workspace) => {
			await createProject(
				workspace,
				{
					...authPluginConfig,
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

			await expectPasskeyInstallAndTypecheck(workspace);
			await expectSchemaPush(workspace.projectRoot);
		});
	}, 600_000);

	it("installs, typechecks, and pushes a prisma planetscale mysql passkey project", async () => {
		await withScenarioWorkspace(
			"smoke-prisma-planetscale-passkey",
			async (workspace) => {
				await createProject(
					workspace,
					{
						...authPluginConfig,
						authentication: "better-auth",
						database: "mysql",
						databaseProvider: "planetscale",
						linter: "biome",
						orm: "prisma",
						packageManager: "pnpm",
						web: "nextjs",
					},
					{ install: true },
				);

				await expectPasskeyInstallAndTypecheck(workspace);
				await expectSchemaPush(
					workspace.projectRoot,
					mysqlDatabaseEnv("forge_smoke_prisma_planetscale"),
				);
			},
		);
	}, 600_000);

	for (const cell of postgresProviderCells) {
		const transactionTitle = {
			supported: "runs a transaction probe",
			unsupported: "confirms the known transaction limitation",
		}[cell.transaction];

		it(`installs, typechecks, and ${transactionTitle} on drizzle with ${cell.provider} postgres`, async () => {
			await withScenarioWorkspace(
				`smoke-drizzle-${cell.provider}`,
				async (workspace) => {
					const name = `forge_smoke_drizzle_${cell.provider.replaceAll("-", "_")}`;
					const url = smokeDatabaseOn(smokeDatabaseUrl(), name);

					await createProject(
						workspace,
						{
							authentication: "better-auth",
							database: "postgresql",
							databaseProvider: cell.provider,
							linter: "biome",
							orm: "drizzle",
							packageManager: "pnpm",
							rpc: "trpc",
							style: "tailwind",
							web: "nextjs",
						},
						{ install: true },
					);

					await writeFile(
						join(workspace.projectRoot, "packages/db/src/transaction-probe.ts"),
						transactionProbeSource,
					);

					await expectInstallAndTypecheck(workspace, "pnpm");

					await createSmokeDatabase(workspace.projectRoot, cell.client, name);

					const probe = await runTransactionProbe(workspace, url);
					switch (cell.transaction) {
						case "supported":
							expect(probe.exitCode, `${probe.stdout}\n${probe.stderr}`).toBe(
								0,
							);

							break;

						case "unsupported":
							expect(probe.exitCode, probe.stderr).not.toBe(0);
							expect(probe.stderr).toContain(
								"No transactions support in neon-http driver",
							);

							break;
					}
				},
			);
		}, 600_000);
	}
});
