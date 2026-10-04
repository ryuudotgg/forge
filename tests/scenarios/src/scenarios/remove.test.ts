import { readFile, rename, writeFile } from "node:fs/promises";
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

interface PackageJson {
	readonly dependencies?: Record<string, string>;
	readonly devDependencies?: Record<string, string>;
}

describe("remove", () => {
	it("removes an addon before a same-named secondary app", async () => {
		await withScenarioWorkspace(
			"remove-app-addon-collision",
			async (workspace) => {
				await createProject(workspace, {
					packageManager: "pnpm",
					web: "nextjs",
					linter: "biome",
					webApps: [{ name: "biome", framework: "nextjs" }],
				});

				await removeAddon(workspace.projectRoot, "biome");

				const manifest = await readJson<{
					config: { linter?: string; webApps: ReadonlyArray<{ name: string }> };
				}>(join(workspace.projectRoot, ".forge/manifest.json"));

				expect(manifest.config.linter).toBeUndefined();
				expect(manifest.config.webApps).toEqual([
					{ name: "biome", framework: "nextjs" },
				]);

				expect(
					await pathExists(
						join(workspace.projectRoot, "apps/biome/forge.json"),
					),
				).toBe(true);

				await removeAddon(workspace.projectRoot, "apps/biome");

				expect(
					await pathExists(
						join(workspace.projectRoot, "apps/biome/forge.json"),
					),
				).toBe(false);
			},
		);
	}, 120_000);

	it("removes a secondary at its moved root", async () => {
		await withScenarioWorkspace("remove-moved-web-app", async (workspace) => {
			await createProject(workspace, {
				packageManager: "pnpm",
				web: "nextjs",
				webApps: [{ name: "admin", framework: "nextjs" }],
			});

			const movedRoot = join(workspace.projectRoot, "apps/dashboard");
			await rename(join(workspace.projectRoot, "apps/admin"), movedRoot);
			await writeFile(join(movedRoot, "notes.txt"), "Keep my notes.\n");
			await removeAddon(workspace.projectRoot, "admin");

			expect(await pathExists(join(movedRoot, "forge.json"))).toBe(false);
			expect(await readFile(join(movedRoot, "notes.txt"), "utf-8")).toBe(
				"Keep my notes.\n",
			);

			const update = await tryRunForge(
				workspace.projectRoot,
				["update", "--keep-user", "--no-install"],
				{ workspaceRoot: workspace.workspaceRoot },
			);

			expect(update.exitCode, update.stdout + update.stderr).toBe(0);

			expect(await pathExists(join(movedRoot, "forge.json"))).toBe(false);
			expect(await pathExists(join(workspace.projectRoot, "apps/admin"))).toBe(
				false,
			);
		});
	}, 120_000);

	it.each(["nextjs", "tanstack-router"])(
		"removes a %s secondary without recreating it on update",
		async (framework) => {
			await withScenarioWorkspace("remove-web-app", async (workspace) => {
				await createProject(workspace, {
					packageManager: "pnpm",
					web: "tanstack-router",
					webApps: [{ name: "site", framework }],
				});

				const userFile = join(workspace.projectRoot, "apps/site/notes.txt");
				await writeFile(userFile, "Keep my notes.\n");

				const primary = await tryRunForge(
					workspace.projectRoot,
					["remove", "web", "--yes", "--no-install"],
					{ workspaceRoot: workspace.workspaceRoot },
				);

				expect(primary.exitCode).toBe(1);
				expect(primary.stdout + primary.stderr).toContain("primary web app");
				await removeAddon(workspace.projectRoot, "site");

				const update = await tryRunForge(
					workspace.projectRoot,
					["update", "--keep-user", "--no-install"],
					{ workspaceRoot: workspace.workspaceRoot },
				);

				expect(update.exitCode, update.stdout + update.stderr).toBe(0);
				expect(await readFile(userFile, "utf-8")).toBe("Keep my notes.\n");
				expect(
					await pathExists(join(workspace.projectRoot, "apps/site/forge.json")),
				).toBe(false);

				expect(
					await pathExists(join(workspace.projectRoot, "apps/web/forge.json")),
				).toBe(true);
			});
		},
		120_000,
	);

	it("removes a single-target addon cleanly", async () => {
		await withScenarioWorkspace("remove", async (workspace) => {
			await createProject(workspace, {
				packageManager: "pnpm",
				web: "nextjs",
			});

			await addAddon(workspace.projectRoot, "biome");

			expect(await pathExists(join(workspace.projectRoot, "biome.json"))).toBe(
				true,
			);

			const rootAfterAdd = await readJson<PackageJson>(
				join(workspace.projectRoot, "package.json"),
			);

			expect(rootAfterAdd.devDependencies?.["@biomejs/biome"]).toBe("catalog:");

			await removeAddon(workspace.projectRoot, "biome");

			const manifest = await readJson<{
				config: { linter?: string };
				installs: Array<{ definitionId: string }>;
			}>(join(workspace.projectRoot, ".forge/manifest.json"));

			expect(
				manifest.installs.some((entry) => entry.definitionId === "biome"),
			).toBe(false);

			expect(manifest.config.linter).toBe(undefined);

			expect(await pathExists(join(workspace.projectRoot, "biome.json"))).toBe(
				false,
			);

			const rootAfterRemove = await readJson<PackageJson>(
				join(workspace.projectRoot, "package.json"),
			);

			expect(
				rootAfterRemove.devDependencies?.["@biomejs/biome"],
			).toBeUndefined();
		});
	}, 120_000);

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

			const manifest = await readJson<{
				config: { orm?: string };
				installs: Array<{ definitionId: string }>;
			}>(join(workspace.projectRoot, ".forge/manifest.json"));

			expect(manifest.config.orm).toBe("drizzle");
			expect(
				manifest.installs.some((entry) => entry.definitionId === "drizzle"),
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
			expect(nextConfig).toContain('"@acme/trpc"');
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

			expect(schema).toContain("datasource db");
			expect(schema).toContain("model User {");
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
