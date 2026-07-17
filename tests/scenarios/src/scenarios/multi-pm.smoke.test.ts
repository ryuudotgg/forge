import { describe, it } from "vitest";
import {
	createProject,
	expectInstallAndTypecheck,
	withScenarioWorkspace,
} from "../utils/harness";

describe.runIf(process.env.FORGE_SMOKE === "1")("multi-pm smoke", () => {
	it("installs and typechecks a bun project", async () => {
		await withScenarioWorkspace("smoke-bun", async (workspace) => {
			await createProject(
				workspace,
				{
					authentication: "better-auth",
					database: "postgresql",
					linter: "biome",
					orm: "drizzle",
					packageManager: "Bun",
					rpc: "trpc",
					style: "tailwind",
					web: "nextjs",
				},
				{ install: true },
			);

			await expectInstallAndTypecheck(workspace, "bun");
		});
	}, 600_000);

	it("installs and typechecks a yarn project", async () => {
		await withScenarioWorkspace("smoke-yarn", async (workspace) => {
			await createProject(
				workspace,
				{
					authentication: "better-auth",
					database: "postgresql",
					linter: "biome",
					orm: "drizzle",
					packageManager: "Yarn",
					rpc: "trpc",
					style: "tailwind",
					web: "nextjs",
				},
				{ install: true },
			);

			await expectInstallAndTypecheck(workspace, "yarn");
		});
	}, 600_000);

	it("installs and typechecks an npm project", async () => {
		await withScenarioWorkspace("smoke-npm", async (workspace) => {
			await createProject(
				workspace,
				{
					authentication: "better-auth",
					database: "postgresql",
					linter: "biome",
					orm: "drizzle",
					packageManager: "npm",
					rpc: "trpc",
					style: "tailwind",
					web: "nextjs",
				},
				{ install: true },
			);

			await expectInstallAndTypecheck(workspace, "npm");
		});
	}, 600_000);
});
