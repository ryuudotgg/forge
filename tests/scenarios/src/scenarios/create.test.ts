import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	createProject,
	pathExists,
	readJson,
	withScenarioWorkspace,
} from "../utils/harness";

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
				modules: Record<string, object>;
			}>(join(workspace.projectRoot, ".forge/manifest.json"));

			const lockfile = await readJson<{
				artifacts: Record<string, object>;
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
			expect(manifest.installs.map((entry) => entry.definitionId)).toEqual(
				expect.arrayContaining([
					"root",
					"pnpm",
					"typescript",
					"biome",
					"ui",
					"tailwind",
					"trpc",
					"drizzle",
				]),
			);

			expect(Object.keys(manifest.modules).length).toBeGreaterThan(0);
			expect(Object.keys(lockfile.artifacts).length).toBeGreaterThan(0);

			expect(appConfig).toMatchObject({ framework: "nextjs", type: "app" });
			expect(uiConfig).toMatchObject({
				packageType: "library",
				type: "package",
			});

			expect(
				await pathExists(join(workspace.projectRoot, "pnpm-workspace.yaml")),
			).toBe(true);

			expect(
				await pathExists(
					join(workspace.projectRoot, "apps/web/app/layout.tsx"),
				),
			).toBe(true);
		});
	}, 240_000);
});
