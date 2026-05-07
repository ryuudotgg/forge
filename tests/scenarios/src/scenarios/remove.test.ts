import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	addAddon,
	createProject,
	pathExists,
	readJson,
	removeAddon,
	withScenarioWorkspace,
} from "../utils/harness";

describe("remove", () => {
	it("removes a single-target addon cleanly", async () => {
		await withScenarioWorkspace("remove", async (workspace) => {
			await createProject(workspace, {
				packageManager: "pnpm",
				web: "nextjs",
			});

			await addAddon(workspace.projectRoot, "biome");
			await removeAddon(workspace.projectRoot, "biome");

			const manifest = await readJson<{
				installs: Array<{ definitionId: string }>;
			}>(join(workspace.projectRoot, ".forge/manifest.json"));

			expect(
				manifest.installs.some((entry) => entry.definitionId === "biome"),
			).toBe(false);

			expect(await pathExists(join(workspace.projectRoot, "biome.jsonc"))).toBe(
				false,
			);
		});
	});
});
