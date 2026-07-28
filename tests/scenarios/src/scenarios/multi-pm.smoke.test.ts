import { describe, it } from "vitest";
import {
	createProject,
	expectInstallAndTypecheck,
	withScenarioWorkspace,
} from "../utils/harness";

type SmokeCase = readonly [
	article: "a" | "an",
	pm: "bun" | "yarn" | "npm",
	packageManager: "Bun" | "Yarn" | "npm",
];

const smokeCases: ReadonlyArray<SmokeCase> = [
	["a", "bun", "Bun"],
	["a", "yarn", "Yarn"],
	["an", "npm", "npm"],
];

describe.runIf(process.env.FORGE_SMOKE === "1")("multi-pm smoke", () => {
	it.each(smokeCases)(
		"installs and typechecks %s %s project",
		async (_article, pm, packageManager) => {
			await withScenarioWorkspace(`smoke-${pm}`, async (workspace) => {
				await createProject(
					workspace,
					{
						authentication: "better-auth",
						database: "postgresql",
						linter: "biome",
						orm: "drizzle",
						packageManager,
						rpc: "trpc",
						style: "tailwind",
						web: "nextjs",
					},
					{ install: true },
				);

				await expectInstallAndTypecheck(workspace, pm);
			});
		},
		600_000,
	);
});
