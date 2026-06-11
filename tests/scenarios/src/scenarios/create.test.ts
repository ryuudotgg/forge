import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	createProject,
	pathExists,
	readJson,
	withScenarioWorkspace,
} from "../utils/harness";

async function listProjectFiles(root: string, prefix = ""): Promise<string[]> {
	const entries = await readdir(join(root, prefix), { withFileTypes: true });
	const files: string[] = [];

	for (const entry of entries) {
		if (entry.name === ".forge") continue;

		const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
		if (entry.isDirectory())
			files.push(...(await listProjectFiles(root, relativePath)));
		else files.push(relativePath);
	}

	return files.sort();
}

describe("create", () => {
	it("creates a recommended first-party workspace with manifest, lockfile, and module metadata", async () => {
		await withScenarioWorkspace("create", async (workspace) => {
			await createProject(workspace, {
				linter: "biome",
				orm: "drizzle",
				packageManager: "pnpm",
				rpc: "trpc",
				style: "tailwind",
				web: "nextjs",
			});

			const manifest = await readJson<{
				config: { slug: string };
				installs: Array<{ definitionId: string }>;
				modules: Record<string, { root?: string }>;
			}>(join(workspace.projectRoot, ".forge/manifest.json"));

			const lockfile = await readJson<{
				artifacts: Record<string, { path: string }>;
			}>(join(workspace.projectRoot, ".forge/lock.json"));

			const appConfig = await readJson<{
				framework: string;
				type: string;
			}>(join(workspace.projectRoot, "apps/web/forge.json"));

			const uiConfig = await readJson<{
				packageType: string;
				type: string;
			}>(join(workspace.projectRoot, "packages/ui/forge.json"));

			expect(manifest.config.slug).toBe("acme");
			expect(
				manifest.installs.map((entry) => entry.definitionId).sort(),
			).toEqual([
				"biome",
				"drizzle",
				"gitignore",
				"pnpm",
				"root",
				"tailwind",
				"trpc",
				"typescript",
				"ui",
			]);

			expect(
				Object.values(manifest.modules)
					.map((module) => module.root)
					.sort(),
			).toEqual(["apps/web", "packages/db", "packages/trpc", "packages/ui"]);

			const projectFiles = await listProjectFiles(workspace.projectRoot);
			const artifactPaths = Object.values(lockfile.artifacts)
				.map((artifact) => artifact.path)
				.sort();

			expect(artifactPaths).toEqual(projectFiles);

			expect(appConfig).toMatchObject({ framework: "nextjs", type: "app" });
			expect(uiConfig).toMatchObject({
				packageType: "library",
				type: "package",
			});

			const root = await readJson<{
				name?: string;
				packageManager?: string;
			}>(join(workspace.projectRoot, "package.json"));

			expect(root.name).toBe("acme");
			expect(root.packageManager).toMatch(/^pnpm@/);

			const workspaceYaml = await readFile(
				join(workspace.projectRoot, "pnpm-workspace.yaml"),
				"utf-8",
			);

			expect(workspaceYaml).toContain('- "apps/*"');
			expect(workspaceYaml).toContain('- "packages/*"');

			expect(
				await pathExists(
					join(workspace.projectRoot, "apps/web/app/layout.tsx"),
				),
			).toBe(true);
		});
	}, 240_000);

	it("rejects better auth configs without an orm before generating anything", async () => {
		await withScenarioWorkspace("create-auth-no-orm", async (workspace) => {
			await expect(
				createProject(workspace, {
					authentication: "better-auth",
					linter: "biome",
					packageManager: "pnpm",
					style: "tailwind",
					web: "nextjs",
				}),
			).rejects.toThrow(/You need to add an ORM/);

			expect(await readdir(workspace.projectRoot)).toEqual([]);
		});
	}, 120_000);
});
