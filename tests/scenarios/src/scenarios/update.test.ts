import { rm } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	createProject,
	pathExists,
	readJson,
	tryRunForge,
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

	it("surfaces planner failures as a friendly error with exit 1", async () => {
		await withScenarioWorkspace("update-planner-error", async (workspace) => {
			await createProject(workspace, {
				packageManager: "pnpm",
				web: "nextjs",
			});

			const manifestPath = join(workspace.projectRoot, ".forge/manifest.json");
			const manifest = await readJson<{
				config: Record<string, unknown>;
				installs: Array<{
					definitionId: string;
					targets: Array<Record<string, string>>;
				}>;
			}>(manifestPath);

			manifest.config.authentication = "better-auth";
			manifest.installs.push({
				definitionId: "better-auth",
				targets: [{ kind: "project" }],
			});

			await writeJson(manifestPath, manifest);

			const result = await tryRunForge(workspace.projectRoot, ["update"], {
				workspaceRoot: workspace.workspaceRoot,
			});

			expect(result.exitCode).toBe(1);
			expect(result.stdout + result.stderr).toContain(
				"We couldn't plan this change.",
			);
			expect(result.stdout + result.stderr).not.toContain("FiberFailure");
		});
	}, 240_000);
});
