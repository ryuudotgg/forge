import { rm } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	createProject,
	pathExists,
	readJson,
	updateProject,
	withScenarioWorkspace,
	writeJson,
} from "../utils/harness";

describe("update", () => {
	it("preserves moved slot paths during replanning", async () => {
		await withScenarioWorkspace("update", async (workspace) => {
			await createProject(workspace, {
				packageManager: "pnpm",
				style: "tailwind",
				web: "nextjs",
			});

			const configPath = join(workspace.projectRoot, "apps/web/forge.json");
			const moduleConfig = await readJson<{
				id: string;
				slots: Record<string, string>;
			}>(configPath);

			moduleConfig.slots.layout = "app/(site)/layout.tsx";
			await writeJson(configPath, moduleConfig);

			await updateProject(workspace.projectRoot);

			expect(
				await pathExists(
					join(workspace.projectRoot, "apps/web/app/(site)/layout.tsx"),
				),
			).toBe(true);
		});
	});

	it("restores missing managed files from the lockfile", async () => {
		await withScenarioWorkspace("update-heal", async (workspace) => {
			await createProject(workspace, {
				packageManager: "pnpm",
				style: "tailwind",
				web: "nextjs",
			});

			const layoutPath = join(workspace.projectRoot, "apps/web/app/layout.tsx");

			await rm(layoutPath, { force: true });
			expect(await pathExists(layoutPath)).toBe(false);

			await updateProject(workspace.projectRoot);

			expect(await pathExists(layoutPath)).toBe(true);
		});
	});
});
