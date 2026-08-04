import { appendFile, readFile, rm, stat } from "node:fs/promises";
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
	it("keeps declined base-less surface renders durable", async () => {
		await withScenarioWorkspace("update-keep-user-page", async (workspace) => {
			await createProject(workspace, {
				packageManager: "pnpm",
				web: "nextjs",
			});

			const pagePath = join(workspace.projectRoot, "apps/web/app/page.tsx");
			const original = await readFile(pagePath, "utf-8");
			await appendFile(pagePath, "// my page tweak\n", "utf-8");
			const userContent = await readFile(pagePath, "utf-8");

			const keepUser = await tryRunForge(
				workspace.projectRoot,
				["update", "--keep-user"],
				{ workspaceRoot: workspace.workspaceRoot },
			);
			expect(keepUser.exitCode).toBe(0);
			expect(await readFile(pagePath, "utf-8")).toBe(userContent);

			const lockfile = await readJson<{
				artifacts: Record<
					string,
					{
						base?: { hash: string; mergeKind: string };
						path: string;
					}
				>;
			}>(join(workspace.projectRoot, ".forge/lock.json"));
			const pageArtifact = Object.values(lockfile.artifacts).find(
				(artifact) => artifact.path === "apps/web/app/page.tsx",
			);
			expect(pageArtifact?.base).toMatchObject({ mergeKind: "opaque" });
			if (pageArtifact?.base === undefined)
				throw new Error("Page Base Not Recorded");
			expect(
				await readFile(
					join(workspace.projectRoot, ".forge/bases", pageArtifact.base.hash),
					"utf-8",
				),
			).toBe(original);

			const before = await stat(pagePath, { bigint: true });
			const plain = await tryRunForge(workspace.projectRoot, ["update"], {
				workspaceRoot: workspace.workspaceRoot,
			});
			const after = await stat(pagePath, { bigint: true });

			expect(plain.exitCode).toBe(0);
			expect(await readFile(pagePath, "utf-8")).toBe(userContent);
			expect(after.ino).toBe(before.ino);
			expect(after.mtimeNs).toBe(before.mtimeNs);
			expect(
				await readFile(
					join(workspace.projectRoot, ".forge/bases", pageArtifact.base.hash),
					"utf-8",
				),
			).toBe(original);
		});
	}, 120_000);

	it("preserves moved slot paths during replanning", async () => {
		await withScenarioWorkspace("update", async (workspace) => {
			await createProject(workspace, {
				packageManager: "pnpm",
				style: "tailwind",
				web: "nextjs",
			});

			const originalLayoutPath = join(
				workspace.projectRoot,
				"apps/web/app/layout.tsx",
			);
			const movedLayoutPath = join(
				workspace.projectRoot,
				"apps/web/app/(site)/layout.tsx",
			);
			const originalLayout = await readFile(originalLayoutPath, "utf-8");

			const configPath = join(workspace.projectRoot, "apps/web/forge.json");
			const moduleConfig = await readJson<{
				id: string;
				slots: Record<string, string>;
			}>(configPath);

			moduleConfig.slots.layout = "app/(site)/layout.tsx";
			await writeJson(configPath, moduleConfig);

			await updateProject(workspace.projectRoot);

			expect(await pathExists(originalLayoutPath)).toBe(false);
			expect(await readFile(movedLayoutPath, "utf-8")).toBe(originalLayout);

			const updatedConfig = await readJson<{
				slots: Record<string, string>;
			}>(configPath);

			expect(updatedConfig.slots.layout).toBe("app/(site)/layout.tsx");
		});
	}, 120_000);

	it("restores missing managed files from the lockfile", async () => {
		await withScenarioWorkspace("update-heal", async (workspace) => {
			await createProject(workspace, {
				packageManager: "pnpm",
				style: "tailwind",
				web: "nextjs",
			});

			const layoutPath = join(workspace.projectRoot, "apps/web/app/layout.tsx");
			const originalLayout = await readFile(layoutPath, "utf-8");

			await rm(layoutPath, { force: true });
			expect(await pathExists(layoutPath)).toBe(false);

			await updateProject(workspace.projectRoot);

			expect(await readFile(layoutPath, "utf-8")).toBe(originalLayout);
		});
	}, 120_000);

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
				"We couldn't plan this change. Definition Dependency Inactive.",
			);
			expect(result.stdout + result.stderr).not.toContain("FiberFailure");
		});
	}, 240_000);
});
