import { describe, it } from "vitest";
import {
	createProject,
	expectInstallBuildAndTypecheck,
	withScenarioWorkspace,
} from "../utils/harness";
import { expectDrainingWorker } from "../utils/install-smoke";

describe.runIf(process.env.FORGE_SMOKE === "1")("install smoke", () => {
	it.each([
		{ primary: "tanstack-router", secondary: "nextjs", backend: "hono" },
		{ primary: "nextjs", secondary: "tanstack-router", backend: "hono" },
		{ primary: "react-router", secondary: "tanstack-start" },
		{ primary: "tanstack-start", secondary: "react-router" },
	])(
		"installs, builds, and typechecks $primary with a $secondary secondary app",
		async ({ primary, secondary, backend }) => {
			await withScenarioWorkspace(
				`smoke-secondary-${primary}-${secondary}`,
				async (workspace) => {
					await createProject(workspace, {
						web: primary,
						backend,
						rpc: "trpc",
						authentication: "better-auth",
						orm: "drizzle",
						database: "sqlite",
						style: "tailwind",
						linter: "biome",
						packageManager: "pnpm",
						webApps: [{ name: "admin", framework: secondary }],
					});

					await expectInstallBuildAndTypecheck(workspace, "pnpm");
				},
			);
		},
		600_000,
	);

	it("installs, builds, and typechecks secondary web apps with a Hono host", async () => {
		await withScenarioWorkspace(
			"smoke-secondary-web-app",
			async (workspace) => {
				await createProject(workspace, {
					web: "tanstack-router",
					backend: "hono",
					rpc: "trpc",
					authentication: "better-auth",
					orm: "drizzle",
					database: "sqlite",
					style: "tailwind",
					linter: "biome",
					packageManager: "pnpm",
					webApps: [{ name: "admin", framework: "tanstack-router" }],
				});

				await expectInstallBuildAndTypecheck(workspace, "pnpm");
			},
		);
	}, 600_000);

	it("installs, builds, and typechecks a full TanStack Start project", async () => {
		await withScenarioWorkspace("smoke-tanstack-start", async (workspace) => {
			await createProject(workspace, {
				authentication: "better-auth",
				database: "postgresql",
				linter: "biome",
				orm: "drizzle",
				packageManager: "pnpm",
				rpc: "trpc",
				style: "tailwind",
				web: "tanstack-start",
			});

			await expectInstallBuildAndTypecheck(workspace, "pnpm");
		});
	}, 600_000);

	it("installs, builds, and typechecks a TanStack Router SPA with a worker", async () => {
		await withScenarioWorkspace("smoke-tanstack-router", async (workspace) => {
			await createProject(workspace, {
				addons: ["worker"],
				linter: "biome",
				packageManager: "pnpm",
				style: "tailwind",
				web: "tanstack-router",
			});

			await expectInstallBuildAndTypecheck(workspace, "pnpm");
			await expectDrainingWorker(workspace.projectRoot);
		});
	}, 600_000);

	it("installs, builds, and typechecks a full React Router project", async () => {
		await withScenarioWorkspace("smoke-react-router", async (workspace) => {
			await createProject(workspace, {
				authentication: "better-auth",
				database: "postgresql",
				linter: "biome",
				orm: "drizzle",
				packageManager: "pnpm",
				rpc: "trpc",
				style: "tailwind",
				web: "react-router",
			});

			await expectInstallBuildAndTypecheck(workspace, "pnpm");
		});
	}, 600_000);
});
