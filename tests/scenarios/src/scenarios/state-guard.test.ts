import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	createProject,
	readJson,
	tryRunForge,
	withScenarioWorkspace,
	writeJson,
} from "../utils/harness";

describe("state guard", () => {
	it("rejects an add when the manifest config is blank", async () => {
		await withScenarioWorkspace("state-guard", async (workspace) => {
			await createProject(workspace, {
				orm: "drizzle",
				packageManager: "pnpm",
				web: "nextjs",
			});

			const manifestPath = join(workspace.projectRoot, ".forge/manifest.json");
			const manifest = await readJson<{
				config?: Record<string, unknown>;
				installs: Array<{ definitionId: string }>;
				modules: Record<string, unknown>;
			}>(manifestPath);

			expect(manifest.installs.length).toBeGreaterThan(0);

			delete manifest.config;
			await writeJson(manifestPath, manifest);

			const result = await tryRunForge(
				workspace.projectRoot,
				["add", "commitlint"],
				{ workspaceRoot: workspace.workspaceRoot },
			);

			expect(result.exitCode).not.toBe(0);
			expect(result.stdout + result.stderr).toContain(
				"We couldn't find a Forge project here. The .forge directory is missing or incomplete.",
			);
		});
	}, 240_000);
});
