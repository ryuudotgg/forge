import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	addAddon,
	createProject,
	pathExists,
	readJson,
	runForge,
	withScenarioWorkspace,
} from "../utils/harness";

describe("add", () => {
	it("installs an addon into the only compatible target without prompting", async () => {
		await withScenarioWorkspace("add", async (workspace) => {
			await createProject(workspace, {
				packageManager: "pnpm",
				web: "nextjs",
			});

			await addAddon(workspace.projectRoot, "tailwind");

			const manifest = await readJson<{
				installs: Array<{ definitionId: string }>;
			}>(join(workspace.projectRoot, ".forge/manifest.json"));

			expect(
				manifest.installs.some((entry) => entry.definitionId === "tailwind"),
			).toBe(true);

			expect(
				await pathExists(join(workspace.projectRoot, "packages/ui/forge.json")),
			).toBe(true);

			expect(
				await pathExists(
					join(workspace.projectRoot, "packages/ui/src/styles/globals.css"),
				),
			).toBe(true);
		});
	});

	it("prompts for an addon when no id is provided", async () => {
		await withScenarioWorkspace("add-prompt", async (workspace) => {
			await createProject(workspace, {
				packageManager: "pnpm",
				web: "nextjs",
			});

			const result = await runForge(workspace.projectRoot, ["add"], {
				input: "tailwind\r",
				workspaceRoot: workspace.workspaceRoot,
			});

			const manifest = await readJson<{
				installs: Array<{
					definitionId: string;
				}>;
			}>(join(workspace.projectRoot, ".forge/manifest.json"));

			expect(result.stdout).toContain("Search for an addon");
			expect(
				manifest.installs.find((entry) => entry.definitionId === "tailwind"),
			).toBeDefined();

			expect(
				await pathExists(
					join(workspace.projectRoot, "packages/ui/src/styles/globals.css"),
				),
			).toBe(true);
		});
	}, 240_000);
});
