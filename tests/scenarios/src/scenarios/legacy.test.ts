import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	addAddon,
	createProject,
	pathExists,
	readJson,
	withScenarioWorkspace,
	writeJson,
} from "../utils/harness";

describe("legacy", () => {
	it("infers the config snapshot when the manifest config is blank", async () => {
		await withScenarioWorkspace("legacy", async (workspace) => {
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

			await addAddon(workspace.projectRoot, "commitlint");

			const updated = await readJson<{
				config: {
					addons?: string[];
					orm?: string;
					slug?: string;
					web?: string;
				};
				installs: Array<{ definitionId: string }>;
			}>(manifestPath);

			expect(updated.config.slug).toBe("acme");
			expect(updated.config.web).toBe("nextjs");
			expect(updated.config.orm).toBe("drizzle");
			expect(updated.config.addons).toContain("commitlint");

			expect(
				updated.installs.some((entry) => entry.definitionId === "commitlint"),
			).toBe(true);

			expect(
				await pathExists(
					join(workspace.projectRoot, "packages/db/drizzle.config.ts"),
				),
			).toBe(true);
			expect(
				await pathExists(join(workspace.projectRoot, "commitlint.config.ts")),
			).toBe(true);
		});
	}, 240_000);
});
