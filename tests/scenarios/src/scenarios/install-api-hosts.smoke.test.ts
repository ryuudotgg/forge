import { readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	createProject,
	expectInstallBuildAndTypecheck,
	forgeEnvironment,
	runCommand,
	withScenarioWorkspace,
} from "../utils/harness";
import {
	expectClientIpRateLimit,
	expectCredentialedGeneratedServer,
	expectProductionOriginsRequired,
	expectStandaloneOrpcRoute,
	injectOrpcContextProbe,
	scriptEnvironment,
} from "../utils/install-smoke";

async function pointTursoAtLocalFile(projectRoot: string) {
	const envPath = join(projectRoot, ".env");
	const databaseFile = join(projectRoot, "packages/db/prisma/local.db");
	const env = await readFile(envPath, "utf8");

	await writeFile(
		envPath,
		env.replace(
			/^TURSO_DATABASE_URL=.*$/m,
			`TURSO_DATABASE_URL="file:${databaseFile}"`,
		),
	);
}

describe.runIf(process.env.FORGE_SMOKE === "1")("install smoke", () => {
	it("requires production server URLs outside CI without bundling localhost defaults", async () => {
		await withScenarioWorkspace("smoke-hono-server-url", async (workspace) => {
			await createProject(workspace, {
				backend: "hono",
				linter: "biome",
				packageManager: "pnpm",
				rpc: "trpc",
				style: "tailwind",
				web: "tanstack-router",
				webApps: [{ name: "admin", framework: "nextjs", client: true }],
			});

			const install = await runCommand("pnpm", ["install"], {
				cwd: workspace.projectRoot,
				env: forgeEnvironment(workspace.workspaceRoot),
			});

			expect(install.exitCode, install.stdout + install.stderr).toBe(0);

			const apps = [
				{ directory: "apps/web", variable: "VITE_SERVER_URL", output: "dist" },
				{
					directory: "apps/admin",
					variable: "NEXT_PUBLIC_SERVER_URL",
					output: ".next",
				},
			];

			const buildEnvironment = {
				...forgeEnvironment(workspace.workspaceRoot),
				...scriptEnvironment({}),
				VITE_SERVER_URL: undefined,
				NEXT_PUBLIC_SERVER_URL: undefined,
			};

			for (const app of apps) {
				const build = await runCommand("pnpm", ["run", "build"], {
					cwd: join(workspace.projectRoot, app.directory),
					env: buildEnvironment,
				});

				expect(build.exitCode, build.stdout + build.stderr).toBe(0);
			}

			const envPath = join(workspace.projectRoot, ".env");
			const generatedEnv = await readFile(envPath, "utf8");
			await writeFile(
				envPath,
				generatedEnv
					.split("\n")
					.filter(
						(line) =>
							!/^\s*(?:export\s+)?(?:VITE_SERVER_URL|NEXT_PUBLIC_SERVER_URL)\s*=/.test(
								line,
							),
					)
					.join("\n"),
			);

			for (const app of apps) {
				const cwd = join(workspace.projectRoot, app.directory);
				const missingUrl = await runCommand("pnpm", ["run", "build"], {
					cwd,
					env: buildEnvironment,
				});

				const missingOutput = missingUrl.stdout + missingUrl.stderr;
				expect(missingUrl.exitCode, missingOutput).not.toBe(0);
				expect(missingOutput, missingOutput).toContain(app.variable);

				const outputDirectory = join(cwd, app.output);
				await rm(outputDirectory, { force: true, recursive: true });

				const ciBuild = await runCommand("pnpm", ["run", "build"], {
					cwd,
					env: { ...buildEnvironment, CI: "true" },
				});

				const ciOutput = ciBuild.stdout + ciBuild.stderr;
				expect(ciBuild.exitCode, ciOutput).toBe(0);

				const files = await readdir(outputDirectory, {
					recursive: true,
					withFileTypes: true,
				});

				for (const file of files) {
					if (!file.isFile() || file.name.endsWith(".map")) continue;

					const path = join(file.parentPath, file.name);
					const content = await readFile(path, "utf8");
					expect(content, `${path}\n${ciOutput}`).not.toContain(
						"localhost:3001",
					);
				}
			}
		});
	}, 600_000);
	it.each([
		{ backend: "hono", databaseProvider: undefined },
		{ backend: "express", databaseProvider: "turso" },
	] as const)(
		"starts a built $backend server on Prisma with SQLite ($databaseProvider)",
		async ({ backend, databaseProvider }) => {
			await withScenarioWorkspace(
				`smoke-prisma-sqlite-${backend}`,
				async (workspace) => {
					await createProject(workspace, {
						authentication: "better-auth",
						backend,
						database: "sqlite",
						databaseProvider,
						linter: "biome",
						orm: "prisma",
						packageManager: "pnpm",
						rpc: "trpc",
						style: "tailwind",
						web: "tanstack-router",
					});

					if (databaseProvider === "turso")
						await pointTursoAtLocalFile(workspace.projectRoot);

					await expectInstallBuildAndTypecheck(workspace, "pnpm");
					await expectCredentialedGeneratedServer(workspace.projectRoot, {
						launch: "start",
					});
				},
			);
		},
		600_000,
	);

	it.each(["hono", "express", "fastify"])(
		"refuses a production %s start without auth until WEB_URL is set",
		async (backend) => {
			await withScenarioWorkspace(
				`smoke-origins-${backend}`,
				async (workspace) => {
					await createProject(workspace, {
						backend,
						linter: "biome",
						packageManager: "pnpm",
						rpc: "trpc",
						style: "tailwind",
						web: "tanstack-router",
					});

					await expectInstallBuildAndTypecheck(workspace, "pnpm");
					await expectProductionOriginsRequired(workspace.projectRoot);
				},
			);
		},
		600_000,
	);

	it.each(["tanstack-router", "react-router"])(
		"installs, builds, and typechecks %s with an oRPC Hono host",
		async (web) => {
			await withScenarioWorkspace(
				`smoke-orpc-hono-${web}`,
				async (workspace) => {
					await createProject(workspace, {
						authentication: "better-auth",
						backend: "hono",
						database: "sqlite",
						linter: "biome",
						orm: "drizzle",
						packageManager: "pnpm",
						rpc: "orpc",
						style: "tailwind",
						web,
					});

					await expectInstallBuildAndTypecheck(workspace, "pnpm");
					await expectCredentialedGeneratedServer(workspace.projectRoot, {
						rpc: "orpc",
						webOrigin:
							web === "react-router"
								? "http://localhost:5173"
								: "http://localhost:3000",
					});
				},
			);
		},
		600_000,
	);

	it.each(["trpc", undefined] as const)(
		"installs, builds, and typechecks react-router beside Hono with rpc %s",
		async (rpc) => {
			await withScenarioWorkspace(
				`smoke-hono-react-router-${rpc ?? "auth"}`,
				async (workspace) => {
					await createProject(workspace, {
						authentication: "better-auth",
						backend: "hono",
						database: "sqlite",
						linter: "biome",
						orm: "drizzle",
						packageManager: "pnpm",
						rpc,
						style: "tailwind",
						web: "react-router",
					});

					await expectInstallBuildAndTypecheck(workspace, "pnpm");

					if (rpc === "trpc")
						await expectCredentialedGeneratedServer(workspace.projectRoot, {
							webOrigin: "http://localhost:5173",
						});
				},
			);
		},
		600_000,
	);

	it.each([
		{ backend: "express", contextProbe: false },
		{ backend: "fastify", contextProbe: true },
	])(
		"installs, builds, and typechecks TanStack Router with an oRPC $backend host",
		async ({ backend, contextProbe }) => {
			await withScenarioWorkspace(
				`smoke-orpc-${backend}-spa`,
				async (workspace) => {
					await createProject(workspace, {
						authentication: "better-auth",
						backend,
						database: "sqlite",
						linter: "biome",
						orm: "drizzle",
						packageManager: "pnpm",
						rpc: "orpc",
						style: "tailwind",
						web: "tanstack-router",
					});

					if (contextProbe) await injectOrpcContextProbe(workspace.projectRoot);

					await expectInstallBuildAndTypecheck(workspace, "pnpm");
					await expectCredentialedGeneratedServer(workspace.projectRoot, {
						rpc: "orpc",
					});

					await expectStandaloneOrpcRoute(workspace.projectRoot, contextProbe);
				},
			);
		},
		600_000,
	);

	it.each(["nextjs", "tanstack-start"])(
		"installs, builds, and typechecks %s as an oRPC Hono client",
		async (web) => {
			await withScenarioWorkspace(
				`smoke-orpc-hono-${web}`,
				async (workspace) => {
					await createProject(workspace, {
						authentication: "better-auth",
						backend: "hono",
						database: "sqlite",
						orm: "drizzle",
						packageManager: "pnpm",
						rpc: "orpc",
						style: "tailwind",
						web,
					});

					await expectInstallBuildAndTypecheck(workspace, "pnpm");
					await expectCredentialedGeneratedServer(workspace.projectRoot, {
						rpc: "orpc",
					});
				},
			);
		},
		600_000,
	);

	it("installs, builds, and typechecks Next.js with a Hono API host", async () => {
		await withScenarioWorkspace("smoke-hono-nextjs", async (workspace) => {
			await createProject(workspace, {
				authentication: "better-auth",
				authMethods: ["email-password", "google", "apple", "passkey"],
				authPlugins: ["username", "admin", "polar"],
				backend: "hono",
				database: "sqlite",
				emailProvider: "smtp",
				linter: "biome",
				orm: "drizzle",
				packageManager: "pnpm",
				rpc: "trpc",
				style: "tailwind",
				web: "nextjs",
			});

			await expectInstallBuildAndTypecheck(workspace, "pnpm");
			await expectCredentialedGeneratedServer(workspace.projectRoot, {
				passkey: true,
				polar: true,
				username: "hono_smoke",
			});

			await expectClientIpRateLimit(workspace.projectRoot, "server");
		});
	}, 600_000);

	it("installs, builds, and typechecks TanStack Router with Hono", async () => {
		await withScenarioWorkspace("smoke-hono-spa", async (workspace) => {
			await createProject(workspace, {
				authentication: "better-auth",
				backend: "hono",
				database: "postgresql",
				emailProvider: "resend",
				linter: "biome",
				orm: "drizzle",
				packageManager: "pnpm",
				rpc: "trpc",
				style: "tailwind",
				web: "tanstack-router",
			});

			await expectInstallBuildAndTypecheck(workspace, "pnpm");
		});
	}, 600_000);

	it("installs, builds, and typechecks Next.js with a Fastify API host", async () => {
		await withScenarioWorkspace("smoke-fastify-nextjs", async (workspace) => {
			await createProject(workspace, {
				authentication: "better-auth",
				authPlugins: ["polar"],
				backend: "fastify",
				database: "sqlite",
				emailProvider: "postmark",
				linter: "biome",
				orm: "drizzle",
				packageManager: "pnpm",
				rpc: "trpc",
				style: "tailwind",
				web: "nextjs",
			});

			await expectInstallBuildAndTypecheck(workspace, "pnpm");
			await expectCredentialedGeneratedServer(workspace.projectRoot, {
				polar: true,
			});
		});
	}, 600_000);

	it("installs, builds, and typechecks TanStack Router with Fastify", async () => {
		await withScenarioWorkspace("smoke-fastify-spa", async (workspace) => {
			await createProject(workspace, {
				authentication: "better-auth",
				backend: "fastify",
				database: "sqlite",
				linter: "biome",
				orm: "drizzle",
				packageManager: "pnpm",
				rpc: "trpc",
				style: "tailwind",
				web: "tanstack-router",
			});

			await expectInstallBuildAndTypecheck(workspace, "pnpm");
			await expectCredentialedGeneratedServer(workspace.projectRoot);
		});
	}, 600_000);

	it("installs, builds, and typechecks Next.js with an Express API host", async () => {
		await withScenarioWorkspace("smoke-express-nextjs", async (workspace) => {
			await createProject(workspace, {
				authentication: "better-auth",
				authPlugins: ["polar"],
				backend: "express",
				database: "sqlite",
				linter: "biome",
				orm: "drizzle",
				packageManager: "pnpm",
				rpc: "trpc",
				style: "tailwind",
				web: "nextjs",
			});

			await expectInstallBuildAndTypecheck(workspace, "pnpm");
			await expectCredentialedGeneratedServer(workspace.projectRoot, {
				polar: true,
			});
		});
	}, 600_000);

	it("installs, builds, and typechecks TanStack Router with Express", async () => {
		await withScenarioWorkspace("smoke-express-spa", async (workspace) => {
			await createProject(workspace, {
				authentication: "better-auth",
				backend: "express",
				database: "sqlite",
				linter: "biome",
				orm: "drizzle",
				packageManager: "pnpm",
				rpc: "trpc",
				style: "tailwind",
				web: "tanstack-router",
			});

			await expectInstallBuildAndTypecheck(workspace, "pnpm");
			await expectCredentialedGeneratedServer(workspace.projectRoot);
		});
	}, 600_000);
});
