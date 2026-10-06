import { describe, expect, it } from "vitest";
import {
	createProject,
	expectInstallAndBuild,
	expectProductionInstall,
	withScenarioWorkspace,
} from "../utils/harness";
import {
	expectDrainingWorker,
	expectSchemaPush,
	readGeneratedEnv,
	signUpSession,
	webAppsOf,
	withGeneratedServer,
	withWebApp,
} from "../utils/install-smoke";

const productionConfig = {
	authentication: "better-auth",
	authMethods: ["email-password"],
	database: "sqlite",
	linter: "biome",
	packageManager: "pnpm",
	rpc: "trpc",
	style: "tailwind",
};

describe.runIf(process.env.FORGE_SMOKE === "1")("install smoke", () => {
	it("starts Hono after a production install with routes and Lefthook", async () => {
		await withScenarioWorkspace("smoke-production-hono", async (workspace) => {
			await createProject(workspace, {
				...productionConfig,
				web: "tanstack-router",
				backend: "hono",
				addons: ["lefthook"],
				orm: "drizzle",
			});

			await expectInstallAndBuild(workspace, "pnpm");
			await expectProductionInstall(workspace);

			const env = await readGeneratedEnv(workspace.projectRoot);
			const origin = env.VITE_SERVER_URL;
			if (origin === undefined)
				throw new Error("Missing Server Origin: VITE_SERVER_URL");

			await withGeneratedServer(
				workspace.projectRoot,
				{},
				origin,
				async (output) => {
					const response = await fetch(`${origin}/`);
					expect(response.status, output()).toBe(200);
				},
				"server",
				"start",
			);
		});
	}, 600_000);

	it("starts both self hosted web apps after a production install", async () => {
		await withScenarioWorkspace(
			"smoke-production-web-apps",
			async (workspace) => {
				await createProject(workspace, {
					...productionConfig,
					web: "tanstack-start",
					backend: "self",
					webApps: [{ name: "admin", framework: "react-router" }],
					orm: "drizzle",
				});

				await expectInstallAndBuild(workspace, "pnpm");
				await expectProductionInstall(workspace);

				const apps = await webAppsOf(workspace.projectRoot);
				expect(apps).toHaveLength(2);

				for (const app of apps)
					await withWebApp(workspace.projectRoot, app, async (output) => {
						const response = await fetch(`http://localhost:${app.port}/`);
						expect(response.status, output()).toBe(200);
					});
			},
		);
	}, 600_000);

	it("authenticates Next.js and starts the worker after a production install", async () => {
		await withScenarioWorkspace(
			"smoke-production-next-worker",
			async (workspace) => {
				await createProject(workspace, {
					...productionConfig,
					web: "nextjs",
					backend: "self",
					orm: "prisma",
					addons: ["worker"],
				});

				await expectInstallAndBuild(workspace, "pnpm");
				await expectSchemaPush(workspace.projectRoot);
				await expectProductionInstall(workspace);

				const env = await readGeneratedEnv(workspace.projectRoot);
				const origin = env.WEB_URL;
				if (origin === undefined)
					throw new Error("Missing Web Origin: WEB_URL");

				const apps = await webAppsOf(workspace.projectRoot);
				expect(apps).toHaveLength(1);

				for (const app of apps)
					await withWebApp(workspace.projectRoot, app, async (output) => {
						await signUpSession(
							origin,
							origin,
							"production@example.com",
							output,
						);
					});

				await expectDrainingWorker(workspace.projectRoot, "start");
			},
		);
	}, 600_000);
});
