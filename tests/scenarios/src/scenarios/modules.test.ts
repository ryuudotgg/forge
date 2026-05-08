import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	createProject,
	readJson,
	renameModuleRoot,
	updateProject,
	withScenarioWorkspace,
} from "../utils/harness";

describe("module identity", () => {
	it("keeps module identity stable across renamed module directories", async () => {
		await withScenarioWorkspace("workspace-structure", async (workspace) => {
			await createProject(workspace, {
				packageManager: "pnpm",
				style: "tailwind",
				web: "nextjs",
			});

			const beforeRename = await readJson<{
				id: string;
			}>(join(workspace.projectRoot, "packages/ui/forge.json"));

			await renameModuleRoot(
				workspace.projectRoot,
				"packages/ui",
				"packages/design-system",
			);

			await updateProject(workspace.projectRoot);

			const manifest = await readJson<{
				modules: Record<string, { root?: string }>;
			}>(join(workspace.projectRoot, ".forge/manifest.json"));

			const afterRename = await readJson<{
				id: string;
			}>(join(workspace.projectRoot, "packages/design-system/forge.json"));

			expect(afterRename.id).toBe(beforeRename.id);
			expect(manifest.modules[beforeRename.id]?.root).toBe(
				"packages/design-system",
			);
		});
	});
});
