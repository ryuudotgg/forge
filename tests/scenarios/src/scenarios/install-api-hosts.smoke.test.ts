import { describe, it } from "vitest";
import {
	createProject,
	expectInstallBuildAndTypecheck,
	withScenarioWorkspace,
} from "../utils/harness";
import {
	expectClientIpRateLimit,
	expectCredentialedGeneratedServer,
	expectStandaloneOrpcRoute,
	injectOrpcContextProbe,
} from "../utils/install-smoke";

describe.runIf(process.env.FORGE_SMOKE === "1")("install smoke", () => {
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
