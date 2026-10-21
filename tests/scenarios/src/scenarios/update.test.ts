import { appendFile, readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	createProject,
	pathExists,
	readJson,
	runCommand,
	tryRunForge,
	updateProject,
	withScenarioWorkspace,
	writeJson,
} from "../utils/harness";

describe("update", () => {
	it("leaves a two-app project clean with keep-user", async () => {
		await withScenarioWorkspace("update-web-apps-clean", async (workspace) => {
			await createProject(workspace, {
				packageManager: "pnpm",
				web: "tanstack-router",
				webApps: [{ name: "site", framework: "nextjs" }],
			});

			const options = { cwd: workspace.projectRoot };
			const init = await runCommand("git", ["init", "-q"], options);
			expect(init.exitCode).toBe(0);
			const add = await runCommand("git", ["add", "."], options);
			expect(add.exitCode).toBe(0);
			const commit = await runCommand(
				"git",
				[
					"-c",
					"user.name=Forge",
					"-c",
					"user.email=forge@example.com",
					"-c",
					"commit.gpgsign=false",
					"-c",
					"core.hooksPath=/dev/null",
					"commit",
					"-qm",
					"fixture",
				],
				options,
			);

			expect(commit.exitCode, commit.stdout + commit.stderr).toBe(0);

			const update = await tryRunForge(
				workspace.projectRoot,
				["update", "--keep-user"],
				{ workspaceRoot: workspace.workspaceRoot },
			);

			expect(update.exitCode, update.stdout + update.stderr).toBe(0);
			const status = await runCommand(
				"git",
				["status", "--porcelain"],
				options,
			);

			expect(status.exitCode).toBe(0);
			expect(status.stdout).toBe("");
		});
	}, 240_000);

	it("leaves a manifest without recorded ports as it is", async () => {
		await withScenarioWorkspace("update-legacy-ports", async (workspace) => {
			await createProject(workspace, {
				packageManager: "pnpm",
				web: "nextjs",
				webApps: [
					{ name: "admin", framework: "nextjs" },
					{ name: "site", framework: "react-router" },
				],
			});

			const manifestPath = join(workspace.projectRoot, ".forge/manifest.json");
			const manifest = await readJson<{
				readonly config: {
					readonly webApps: ReadonlyArray<Record<string, unknown>>;
				};
			}>(manifestPath);

			const legacyConfig = {
				...manifest.config,
				webApps: manifest.config.webApps.map(({ port: _port, ...app }) => app),
			};

			await writeJson(manifestPath, { ...manifest, config: legacyConfig });
			await updateProject(workspace.projectRoot);

			expect(
				(await readJson<{ readonly config: unknown }>(manifestPath)).config,
			).toEqual(legacyConfig);

			const site = await readJson<{ readonly scripts: { dev: string } }>(
				join(workspace.projectRoot, "apps/site/package.json"),
			);

			expect(site.scripts.dev).toContain("--port 3003");
		});
	}, 120_000);

	it("keeps declined base-less surface renders durable", async () => {
		await withScenarioWorkspace(
			"update-keep-user-layout",
			async (workspace) => {
				await createProject(workspace, {
					packageManager: "pnpm",
					web: "nextjs",
				});

				const layoutPath = join(
					workspace.projectRoot,
					"apps/web/app/layout.tsx",
				);
				const original = await readFile(layoutPath, "utf-8");
				await appendFile(layoutPath, "// my layout tweak\n", "utf-8");
				const userContent = await readFile(layoutPath, "utf-8");

				const keepUser = await tryRunForge(
					workspace.projectRoot,
					["update", "--keep-user"],
					{ workspaceRoot: workspace.workspaceRoot },
				);

				expect(keepUser.exitCode).toBe(0);
				expect(await readFile(layoutPath, "utf-8")).toBe(userContent);

				const lockfile = await readJson<{
					artifacts: Record<
						string,
						{
							base?: { hash: string; mergeKind: string };
							path: string;
						}
					>;
				}>(join(workspace.projectRoot, ".forge/lock.json"));

				const layoutArtifact = Object.values(lockfile.artifacts).find(
					(artifact) => artifact.path === "apps/web/app/layout.tsx",
				);

				expect(layoutArtifact?.base).toMatchObject({ mergeKind: "opaque" });

				if (layoutArtifact?.base === undefined)
					throw new Error("Layout Base Not Recorded");

				expect(
					await readFile(
						join(
							workspace.projectRoot,
							".forge/bases",
							layoutArtifact.base.hash,
						),
						"utf-8",
					),
				).toBe(original);

				const before = await stat(layoutPath, { bigint: true });
				const plain = await tryRunForge(workspace.projectRoot, ["update"], {
					workspaceRoot: workspace.workspaceRoot,
				});

				const after = await stat(layoutPath, { bigint: true });

				expect(plain.exitCode).toBe(0);
				expect(await readFile(layoutPath, "utf-8")).toBe(userContent);
				expect(after.ino).toBe(before.ino);
				expect(after.mtimeNs).toBe(before.mtimeNs);
				expect(
					await readFile(
						join(
							workspace.projectRoot,
							".forge/bases",
							layoutArtifact.base.hash,
						),
						"utf-8",
					),
				).toBe(original);
			},
		);
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

	it("keeps a deleted Hono server absent", async () => {
		await withScenarioWorkspace("update-deleted-server", async (workspace) => {
			await createProject(workspace, {
				backend: "hono",
				packageManager: "pnpm",
				web: "nextjs",
			});

			const serverRoot = join(workspace.projectRoot, "apps/server");
			expect(await pathExists(join(serverRoot, "forge.json"))).toBe(true);

			await rm(serverRoot, { force: true, recursive: true });
			await updateProject(workspace.projectRoot);
			await updateProject(workspace.projectRoot);

			expect(await pathExists(serverRoot)).toBe(false);

			const manifest = await readJson<{
				modules: Record<string, { readonly root?: string }>;
			}>(join(workspace.projectRoot, ".forge/manifest.json"));

			expect(
				Object.values(manifest.modules).map((module) => module.root),
			).not.toContain("apps/server");
		});
	}, 120_000);

	it("keeps a deleted secondary web app absent and points at forge remove", async () => {
		await withScenarioWorkspace(
			"update-deleted-secondary",
			async (workspace) => {
				await createProject(workspace, {
					packageManager: "pnpm",
					web: "nextjs",
					webApps: [{ name: "admin", framework: "nextjs" }],
				});

				const adminRoot = join(workspace.projectRoot, "apps/admin");
				await rm(adminRoot, { force: true, recursive: true });

				const update = await tryRunForge(workspace.projectRoot, ["update"], {
					workspaceRoot: workspace.workspaceRoot,
				});

				expect(update.exitCode, update.stdout + update.stderr).toBe(0);
				expect(update.stdout).toContain(
					"We skipped the admin web app because its folder is missing. Run forge remove admin to drop it from your config.",
				);

				expect(await pathExists(adminRoot)).toBe(false);

				const remove = await tryRunForge(
					workspace.projectRoot,
					["remove", "admin"],
					{ workspaceRoot: workspace.workspaceRoot },
				);

				expect(remove.exitCode, remove.stdout + remove.stderr).toBe(0);
				expect(await pathExists(adminRoot)).toBe(false);
				expect(
					(
						await readJson<{
							readonly config: { readonly webApps?: ReadonlyArray<unknown> };
						}>(join(workspace.projectRoot, ".forge/manifest.json"))
					).config.webApps ?? [],
				).toEqual([]);
			},
		);
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

			manifest.installs.push({
				definitionId: "nativewind",
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
