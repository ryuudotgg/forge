import { describe, it } from "vitest";
import {
	createProject,
	expectInstallBuildAndTypecheck,
	withScenarioWorkspace,
} from "../utils/harness";
import {
	expectCredentialedGeneratedServer,
	expectOrpcBodyLimitOnServer,
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

					await expectOrpcBodyLimitOnServer(workspace.projectRoot);
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
});
