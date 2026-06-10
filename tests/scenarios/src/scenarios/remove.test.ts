import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	addAddon,
	createProject,
	pathExists,
	readJson,
	removeAddon,
	tryRunForge,
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

	it("refuses to remove the orm while better-auth depends on it", async () => {
		await withScenarioWorkspace("remove-orm-blocked", async (workspace) => {
			await createProject(workspace, {
				authentication: "better-auth",
				orm: "drizzle",
				packageManager: "pnpm",
				web: "nextjs",
			});

			const result = await tryRunForge(
				workspace.projectRoot,
				["remove", "drizzle"],
				{ workspaceRoot: workspace.workspaceRoot },
			);

			expect(result.exitCode).toBe(1);
			expect(result.stdout + result.stderr).toContain(
				"We can't remove the ORM until you remove Better Auth.",
			);

			expect(
				await pathExists(
					join(workspace.projectRoot, "packages/db/drizzle.config.ts"),
				),
			).toBe(true);
		});
	}, 240_000);

	it("removes the orm and its db package once nothing depends on it", async () => {
		await withScenarioWorkspace("remove-orm", async (workspace) => {
			await createProject(workspace, {
				orm: "drizzle",
				packageManager: "pnpm",
				rpc: "trpc",
				web: "nextjs",
			});

			await removeAddon(workspace.projectRoot, "drizzle");

			const manifest = await readJson<{
				config: { orm?: string };
				installs: Array<{ definitionId: string }>;
			}>(join(workspace.projectRoot, ".forge/manifest.json"));

			expect(manifest.config.orm).toBe(undefined);
			expect(
				manifest.installs.some((entry) => entry.definitionId === "drizzle"),
			).toBe(false);

			expect(await pathExists(join(workspace.projectRoot, "packages/db"))).toBe(
				false,
			);

			const readText = (path: string) =>
				readFile(join(workspace.projectRoot, path), "utf-8");

			const [nextConfig, trpcPackageJson] = await Promise.all([
				readText("apps/web/next.config.ts"),
				readJson<{ dependencies?: Record<string, string> }>(
					join(workspace.projectRoot, "packages/trpc/package.json"),
				),
			]);

			expect(nextConfig).not.toContain('"@acme/db"');
			expect(trpcPackageJson.dependencies).not.toHaveProperty("@acme/db");
		});
	}, 240_000);

	it("removes better-auth and then the orm cleanly", async () => {
		await withScenarioWorkspace("remove-both-ways", async (workspace) => {
			await createProject(workspace, {
				authentication: "better-auth",
				orm: "prisma",
				packageManager: "pnpm",
				web: "nextjs",
			});

			await removeAddon(workspace.projectRoot, "better-auth");

			const schema = await readFile(
				join(workspace.projectRoot, "packages/db/prisma/schema.prisma"),
				"utf-8",
			);

			expect(
				await pathExists(join(workspace.projectRoot, "packages/auth")),
			).toBe(false);
			expect(schema).not.toContain("model Session {");

			await removeAddon(workspace.projectRoot, "prisma");

			expect(await pathExists(join(workspace.projectRoot, "packages/db"))).toBe(
				false,
			);

			const manifest = await readJson<{
				config: { authentication?: string; orm?: string };
			}>(join(workspace.projectRoot, ".forge/manifest.json"));

			expect(manifest.config.authentication).toBe(undefined);
			expect(manifest.config.orm).toBe(undefined);
		});
	}, 240_000);
});
