import { createHash } from "node:crypto";
import {
	appendFile,
	mkdir,
	readdir,
	readFile,
	rename,
	rm,
	writeFile,
} from "node:fs/promises";
import { join, relative } from "node:path";
import { NodeServices } from "@effect/platform-node";
import { Apply, CliVersion, CoreLive, Planner } from "@ryuugg/core";
import {
	type ForgeConfig,
	loadDefinitionRegistry,
	withWebAppPorts,
} from "@ryuugg/generators";
import { Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";
import {
	addAddon,
	createProject,
	pathExists,
	readJson,
	removeAddon,
	repoRoot,
	runForge,
	tryRunForge,
	withScenarioWorkspace,
	writeJson,
} from "../utils/harness";

async function createLegacyProject(projectRoot: string, config: ForgeConfig) {
	const { version } = await readJson<{ version: string }>(
		join(repoRoot, "packages/cli/package.json"),
	);

	const layer = CoreLive.pipe(
		Layer.provide(Layer.succeed(CliVersion, { version })),
		Layer.provideMerge(NodeServices.layer),
	);

	const plan = Effect.gen(function* () {
		const planner = yield* Planner;
		const created = yield* planner.planCreate(
			projectRoot,
			withWebAppPorts(config),
			loadDefinitionRegistry().registry,
			{ node: process.versions.node, pnpm: "10.12.1" },
		);

		yield* Apply.applyPlan(projectRoot, {
			lockfile: created.lockfile,
			manifest: created.manifest,
			removals: created.removals,
			writes: created.writes.map((write) => ({
				artifactId: write.artifactId,
				content: write.content,
				path: write.path,
			})),
		});
	});

	await Effect.runPromise(plan.pipe(Effect.provide(layer)));
}

async function treeHashes(projectRoot: string, excludedRoot?: string) {
	const entries = await readdir(projectRoot, {
		recursive: true,
		withFileTypes: true,
	});

	const hashes: Record<string, string> = {};
	for (const entry of entries) {
		const path = relative(projectRoot, join(entry.parentPath, entry.name));
		if (
			!entry.isFile() ||
			path.startsWith(".forge/") ||
			(excludedRoot !== undefined && path.startsWith(`${excludedRoot}/`))
		)
			continue;

		hashes[path] = createHash("sha256")
			.update(await readFile(join(projectRoot, path)))
			.digest("hex");
	}

	return hashes;
}

interface PackageJson {
	readonly dependencies?: Record<string, string>;
	readonly devDependencies?: Record<string, string>;
	readonly scripts?: Record<string, string>;
}

interface WebAppsManifest {
	readonly config: {
		readonly webApps?: ReadonlyArray<Record<string, unknown>>;
	};
}

async function forgetRecordedPorts(projectRoot: string) {
	const path = join(projectRoot, ".forge/manifest.json");
	const manifest = await readJson<WebAppsManifest>(path);

	await writeJson(path, {
		...manifest,
		config: {
			...manifest.config,
			webApps: manifest.config.webApps?.map(({ port: _port, ...app }) => app),
		},
	});
}

async function serveScripts(projectRoot: string, apps: ReadonlyArray<string>) {
	return Object.fromEntries(
		await Promise.all(
			apps.map(async (app) => {
				const { scripts } = await readJson<PackageJson>(
					join(projectRoot, "apps", app, "package.json"),
				);

				return [app, { dev: scripts?.dev, start: scripts?.start }] as const;
			}),
		),
	);
}

function fileHash(path: string) {
	return readFile(path).then((content) =>
		createHash("sha256").update(content).digest("hex"),
	);
}

describe("remove", () => {
	it.each([
		{ label: "recorded", legacy: false },
		{ label: "derived from list order", legacy: true },
	])(
		"keeps the other apps on their ports when their ports are $label",
		async ({ legacy }) => {
			await withScenarioWorkspace(
				`remove-stable-ports-${legacy}`,
				async (workspace) => {
					await createProject(workspace, {
						backend: "hono",
						packageManager: "pnpm",
						rpc: "trpc",
						web: "nextjs",
						webApps: [
							{ name: "admin", framework: "nextjs" },
							{ name: "docs", framework: "tanstack-router", client: true },
							{ name: "site", framework: "react-router", client: true },
						],
					});

					if (legacy) await forgetRecordedPorts(workspace.projectRoot);

					const manifestPath = join(
						workspace.projectRoot,
						".forge/manifest.json",
					);

					const envPath = join(workspace.projectRoot, ".env");
					const scriptsBefore = await serveScripts(workspace.projectRoot, [
						"admin",
						"site",
					]);

					const envBefore = await fileHash(envPath);
					expect(scriptsBefore.site?.dev).toContain("--port 3004");

					const removed = await runForge(
						workspace.projectRoot,
						["remove", "docs"],
						{ workspaceRoot: workspace.workspaceRoot },
					);

					expect(removed.stdout).toContain("We removed the docs web app.");
					expect(removed.stdout).toContain(
						'Remove http://localhost:3003 from WEB_URLS in .env. With only local apps, that leaves WEB_URLS="http://localhost:3004".',
					);

					expect(
						await serveScripts(workspace.projectRoot, ["admin", "site"]),
					).toEqual(scriptsBefore);

					expect(await fileHash(envPath)).toBe(envBefore);
					expect(
						(await readJson<WebAppsManifest>(manifestPath)).config.webApps,
					).toEqual([
						{ name: "admin", framework: "nextjs", port: 3002 },
						{
							name: "site",
							framework: "react-router",
							client: true,
							port: 3004,
						},
					]);

					const removedManifest = await readFile(manifestPath, "utf-8");
					for (const _run of [1, 2]) {
						await runForge(workspace.projectRoot, ["update"], {
							workspaceRoot: workspace.workspaceRoot,
						});

						expect(await readFile(manifestPath, "utf-8")).toBe(removedManifest);
					}
				},
			);
		},
		240_000,
	);

	it("drops the primary role when the last secondary is removed", async () => {
		await withScenarioWorkspace("remove-last-secondary", async (workspace) => {
			await createProject(workspace, {
				packageManager: "pnpm",
				web: "nextjs",
				webApps: [{ name: "admin", framework: "nextjs" }],
			});

			const markerPath = join(workspace.projectRoot, "apps/web/forge.json");
			expect(await readJson<{ role?: string }>(markerPath)).toMatchObject({
				role: "primary",
			});

			const removed = await runForge(
				workspace.projectRoot,
				["remove", "admin"],
				{ workspaceRoot: workspace.workspaceRoot },
			);

			expect(removed.stdout).toContain("We removed the admin web app.");
			expect(removed.stdout).not.toContain("WEB_URLS");
			expect(await readJson<{ role?: string }>(markerPath)).not.toHaveProperty(
				"role",
			);

			await runForge(workspace.projectRoot, ["update"], {
				workspaceRoot: workspace.workspaceRoot,
			});

			expect(await readJson<{ role?: string }>(markerPath)).not.toHaveProperty(
				"role",
			);
		});
	}, 120_000);

	it("removes a secondary named primary without removing the primary app", async () => {
		await withScenarioWorkspace("remove-primary-name", async (workspace) => {
			await createProject(workspace, {
				packageManager: "pnpm",
				web: "nextjs",
				webApps: [{ name: "primary", framework: "nextjs" }],
			});

			await removeAddon(workspace.projectRoot, "primary");

			expect(
				await pathExists(
					join(workspace.projectRoot, "apps/primary/forge.json"),
				),
			).toBe(false);

			expect(
				await pathExists(join(workspace.projectRoot, "apps/web/forge.json")),
			).toBe(true);
		});
	}, 120_000);

	it("removes an adopted secondary with a noncanonical root and package name", async () => {
		await withScenarioWorkspace(
			"remove-adopted-secondary",
			async (workspace) => {
				await createProject(workspace, {
					packageManager: "pnpm",
					web: "nextjs",
					webApps: [{ name: "admin", framework: "nextjs" }],
				});

				const adoptedRoot = join(workspace.projectRoot, "sites/admin");
				await mkdir(join(workspace.projectRoot, "sites"));
				await rename(join(workspace.projectRoot, "apps/admin"), adoptedRoot);

				const packagePath = join(adoptedRoot, "package.json");
				const appPackage = await readJson<PackageJson>(packagePath);
				await writeFile(
					packagePath,
					JSON.stringify({ ...appPackage, name: "legacy-console" }),
				);

				const workspacePath = join(
					workspace.projectRoot,
					"pnpm-workspace.yaml",
				);

				const workspaceConfig = await readFile(workspacePath, "utf-8");
				await writeFile(
					workspacePath,
					workspaceConfig.replace("packages:\n", "packages:\n  - 'sites/*'\n"),
				);

				await rm(join(workspace.projectRoot, ".forge"), { recursive: true });
				await rm(join(workspace.projectRoot, "apps/web/forge.json"));
				await rm(join(workspace.projectRoot, "packages/ui/forge.json"));
				await rm(join(adoptedRoot, "forge.json"));

				const initConfigPath = join(workspace.workspaceRoot, "forge.init.json");
				await writeJson(initConfigPath, {
					name: "acme",
					slug: "acme",
					path: ".",
					packageManager: "pnpm",
					platforms: ["web"],
					runtime: "Node.js",
					web: "nextjs",
					modules: [
						{ kind: "web-app", root: "sites/admin" },
						{ kind: "web-app", root: "apps/web" },
						{ kind: "ui", root: "packages/ui" },
					],
				});

				await runForge(
					workspace.projectRoot,
					["init", "--config", initConfigPath, "--no-install"],
					{ workspaceRoot: workspace.workspaceRoot },
				);

				const adopted = await treeHashes(workspace.projectRoot);
				const forced = await tryRunForge(
					workspace.projectRoot,
					["remove", "legacy-console", "--accept-forge"],
					{ workspaceRoot: workspace.workspaceRoot },
				);

				expect(forced.exitCode).toBe(1);
				expect(forced.stdout + forced.stderr).toContain(
					"pnpm-workspace.yaml sits outside the app you're removing, so --accept-forge leaves it alone.",
				);

				expect(forced.stdout + forced.stderr).toContain(
					"Run again with --keep-user to keep your edits to pnpm-workspace.yaml.",
				);

				expect(forced.stdout + forced.stderr).not.toContain("sites/admin/");
				expect(await treeHashes(workspace.projectRoot)).toEqual(adopted);

				const update = await tryRunForge(
					workspace.projectRoot,
					["update", "--keep-user", "--no-install"],
					{ workspaceRoot: workspace.workspaceRoot },
				);

				expect(update.exitCode, update.stdout + update.stderr).toBe(0);

				const packageKey = relative(workspace.projectRoot, packagePath);
				const withoutPackage = (hashes: Record<string, string>) =>
					Object.fromEntries(
						Object.entries(hashes).filter(([path]) => path !== packageKey),
					);

				expect(withoutPackage(await treeHashes(workspace.projectRoot))).toEqual(
					withoutPackage(adopted),
				);

				expect(await readJson<{ name: string }>(packagePath)).toMatchObject({
					name: "legacy-console",
				});

				const removed = await tryRunForge(
					workspace.projectRoot,
					["remove", "legacy-console"],
					{ workspaceRoot: workspace.workspaceRoot },
				);

				expect(removed.exitCode, removed.stdout + removed.stderr).toBe(0);
				expect(removed.stdout + removed.stderr).toContain(
					"We kept your edited file at sites/admin/package.json.",
				);

				expect(removed.stdout + removed.stderr).toContain(
					"sites/admin is still a workspace package, so delete the folder to finish the removal.",
				);

				expect(await pathExists(join(adoptedRoot, "forge.json"))).toBe(false);
				expect(await readJson<{ name: string }>(packagePath)).toMatchObject({
					name: "legacy-console",
				});

				expect(await readFile(workspacePath, "utf-8")).toContain("sites/*");
				expect(
					await pathExists(join(workspace.projectRoot, "apps/web/forge.json")),
				).toBe(true);
			},
		);
	}, 120_000);

	it("removes a legacy secondary named after an addon before the addon", async () => {
		await withScenarioWorkspace(
			"remove-app-addon-collision",
			async (workspace) => {
				await createLegacyProject(workspace.projectRoot, {
					name: "acme",
					slug: "acme",
					path: ".",
					packageManager: "pnpm",
					platforms: ["web"],
					runtime: "Node.js",
					web: "nextjs",
					linter: "biome",
					webApps: [{ name: "biome", framework: "nextjs" }],
				});

				const legacyRoot = join(workspace.projectRoot, "apps/biome");
				const legacy = await readJson<{
					config: { webApps?: ReadonlyArray<{ name: string }> };
				}>(join(workspace.projectRoot, ".forge/manifest.json"));

				expect(legacy.config.webApps).toEqual([
					{ name: "biome", framework: "nextjs", port: 3002 },
				]);

				await removeAddon(workspace.projectRoot, "biome");

				const manifest = await readJson<{
					config: { linter?: string; webApps: ReadonlyArray<{ name: string }> };
					installs: ReadonlyArray<{ definitionId: string }>;
				}>(join(workspace.projectRoot, ".forge/manifest.json"));

				expect(manifest.config.linter).toBe("biome");
				expect(manifest.config.webApps).toEqual([]);
				expect(
					manifest.installs.some((install) => install.definitionId === "biome"),
				).toBe(true);

				expect(
					await pathExists(join(workspace.projectRoot, "biome.json")),
				).toBe(true);

				expect(await pathExists(join(legacyRoot, "forge.json"))).toBe(false);

				const refused = await tryRunForge(
					workspace.projectRoot,
					["add", "nextjs", "--name", "biome", "--no-install"],
					{ workspaceRoot: workspace.workspaceRoot },
				);

				expect(refused.exitCode).toBe(1);
				expect(refused.stdout + refused.stderr).toContain(
					"biome is an addon id. Pick another name for this web app.",
				);

				expect(await pathExists(join(legacyRoot, "forge.json"))).toBe(false);

				const createConfigPath = join(workspace.workspaceRoot, "biome.json");
				await writeJson(createConfigPath, {
					name: "other",
					path: "./other",
					platforms: ["web"],
					runtime: "Node.js",
					slug: "other",
					packageManager: "pnpm",
					web: "nextjs",
					webApps: [{ name: "biome", framework: "nextjs" }],
				});

				const created = await tryRunForge(
					workspace.workspaceRoot,
					["create", "--config", createConfigPath, "--no-install", "--no-git"],
					{ workspaceRoot: workspace.workspaceRoot },
				);

				expect(created.exitCode).toBe(1);
				expect(created.stdout + created.stderr).toContain(
					"biome is an addon id. Pick another name for this web app.",
				);

				expect(await pathExists(join(workspace.workspaceRoot, "other"))).toBe(
					false,
				);
			},
		);
	}, 120_000);

	it("removes a secondary whose directory is gone and keeps it gone", async () => {
		await withScenarioWorkspace("remove-missing-web-app", async (workspace) => {
			await createProject(workspace, {
				packageManager: "pnpm",
				style: "tailwind",
				web: "nextjs",
				webApps: [{ name: "admin", framework: "nextjs" }],
			});

			const adminRoot = join(workspace.projectRoot, "apps/admin");
			await rm(adminRoot, { force: true, recursive: true });
			await removeAddon(workspace.projectRoot, "admin");

			const update = await tryRunForge(
				workspace.projectRoot,
				["update", "--no-install"],
				{ workspaceRoot: workspace.workspaceRoot },
			);

			expect(update.exitCode, update.stdout + update.stderr).toBe(0);
			expect(await pathExists(adminRoot)).toBe(false);

			const manifest = await readJson<{
				config: { webApps?: ReadonlyArray<{ name: string }> };
				modules: Record<string, { readonly root?: string }>;
			}>(join(workspace.projectRoot, ".forge/manifest.json"));

			expect(manifest.config.webApps ?? []).toEqual([]);
			expect(
				Object.values(manifest.modules).map((module) => module.root),
			).not.toContain("apps/admin");

			const lockfile = await readJson<{
				artifacts: Record<string, { readonly path: string }>;
			}>(join(workspace.projectRoot, ".forge/lock.json"));

			expect(
				Object.values(lockfile.artifacts).filter((artifact) =>
					artifact.path.startsWith("apps/admin/"),
				),
			).toEqual([]);
		});
	}, 120_000);

	it("keeps an edited file when it removes its app", async () => {
		await withScenarioWorkspace("remove-edited-web-app", async (workspace) => {
			await createProject(workspace, {
				packageManager: "pnpm",
				web: "nextjs",
				webApps: [{ name: "admin", framework: "nextjs" }],
			});

			const page = join(workspace.projectRoot, "apps/admin/app/page.tsx");
			await appendFile(page, "// my edit\n");
			const edited = await readFile(page, "utf-8");

			const removed = await tryRunForge(
				workspace.projectRoot,
				["remove", "admin"],
				{ workspaceRoot: workspace.workspaceRoot },
			);

			expect(removed.exitCode, removed.stdout + removed.stderr).toBe(0);
			expect(removed.stdout + removed.stderr).toContain(
				"We kept your edited file at apps/admin/app/page.tsx.",
			);

			expect(await readFile(page, "utf-8")).toBe(edited);
			expect(
				await pathExists(join(workspace.projectRoot, "apps/admin/forge.json")),
			).toBe(false);

			expect(
				await pathExists(
					join(workspace.projectRoot, "apps/admin/app/layout.tsx"),
				),
			).toBe(false);

			const update = await tryRunForge(
				workspace.projectRoot,
				["update", "--no-install"],
				{ workspaceRoot: workspace.workspaceRoot },
			);

			expect(update.exitCode, update.stdout + update.stderr).toBe(0);
			expect(await readFile(page, "utf-8")).toBe(edited);
			expect(
				await pathExists(join(workspace.projectRoot, "apps/admin/forge.json")),
			).toBe(false);
		});
	}, 120_000);

	it("limits accept-forge to the removed app", async () => {
		await withScenarioWorkspace("remove-scoped-force", async (workspace) => {
			await createProject(workspace, {
				packageManager: "pnpm",
				web: "nextjs",
				webApps: [
					{ name: "docs", framework: "nextjs" },
					{ name: "admin", framework: "nextjs" },
				],
			});

			const adminPage = join(workspace.projectRoot, "apps/admin/app/page.tsx");
			const webPage = join(workspace.projectRoot, "apps/web/app/page.tsx");
			const webOriginal = await readFile(webPage, "utf-8");
			await appendFile(adminPage, "// admin edit\n");
			await appendFile(webPage, "// web edit\n");
			const survivorsBefore = await treeHashes(
				workspace.projectRoot,
				"apps/admin",
			);

			const refused = await tryRunForge(
				workspace.projectRoot,
				["remove", "admin", "--accept-forge"],
				{ workspaceRoot: workspace.workspaceRoot },
			);

			expect(refused.exitCode).toBe(1);
			expect(refused.stdout + refused.stderr).toContain(
				"apps/web/app/page.tsx was modified after Forge last managed it.",
			);

			expect(await treeHashes(workspace.projectRoot, "apps/admin")).toEqual(
				survivorsBefore,
			);

			expect(await readFile(adminPage, "utf-8")).toContain("// admin edit");

			await writeFile(webPage, webOriginal);
			const survivorsClean = await treeHashes(
				workspace.projectRoot,
				"apps/admin",
			);

			await runForge(
				workspace.projectRoot,
				["remove", "admin", "--accept-forge"],
				{ workspaceRoot: workspace.workspaceRoot },
			);

			expect(await pathExists(adminPage)).toBe(false);
			expect(await treeHashes(workspace.projectRoot, "apps/admin")).toEqual(
				survivorsClean,
			);
		});
	}, 120_000);

	it("removes a regenerated route tree with its app", async () => {
		await withScenarioWorkspace("remove-route-tree", async (workspace) => {
			await createProject(workspace, {
				packageManager: "pnpm",
				web: "tanstack-router",
				webApps: [{ name: "site", framework: "tanstack-router" }],
			});

			const generated = "// generated by tsr\n";
			const webTree = join(
				workspace.projectRoot,
				"apps/web/src/routeTree.gen.ts",
			);

			const siteTree = join(
				workspace.projectRoot,
				"apps/site/src/routeTree.gen.ts",
			);

			await writeFile(webTree, generated);
			await writeFile(siteTree, generated);

			const update = await tryRunForge(
				workspace.projectRoot,
				["update", "--no-install"],
				{ workspaceRoot: workspace.workspaceRoot },
			);

			expect(update.exitCode, update.stdout + update.stderr).toBe(0);
			expect(await readFile(webTree, "utf-8")).toBe(generated);

			const removed = await tryRunForge(
				workspace.projectRoot,
				["remove", "site"],
				{ workspaceRoot: workspace.workspaceRoot },
			);

			expect(removed.exitCode, removed.stdout + removed.stderr).toBe(0);
			expect(removed.stdout + removed.stderr).not.toContain(
				"We kept your edited",
			);

			expect(await readFile(webTree, "utf-8")).toBe(generated);
			expect(await pathExists(join(workspace.projectRoot, "apps/site"))).toBe(
				false,
			);
		});
	}, 120_000);

	it("removes a regenerated route tree from an older lockfile", async () => {
		await withScenarioWorkspace("remove-old-route-tree", async (workspace) => {
			await createProject(workspace, {
				packageManager: "pnpm",
				web: "tanstack-router",
				webApps: [{ name: "site", framework: "tanstack-router" }],
			});

			const lockfilePath = join(workspace.projectRoot, ".forge/lock.json");
			const lockfile = await readJson<{
				artifacts: Record<string, { generated?: boolean }>;
			}>(lockfilePath);

			for (const artifact of Object.values(lockfile.artifacts)) {
				delete artifact.generated;
			}

			await writeJson(lockfilePath, lockfile);
			await writeFile(
				join(workspace.projectRoot, "apps/site/src/routeTree.gen.ts"),
				"export const routeTree = regenerated;\n",
			);

			const removed = await tryRunForge(
				workspace.projectRoot,
				["remove", "site"],
				{ workspaceRoot: workspace.workspaceRoot },
			);

			expect(removed.exitCode, removed.stdout + removed.stderr).toBe(0);
			expect(removed.stdout + removed.stderr).not.toContain(
				"We kept your edited",
			);

			expect(await pathExists(join(workspace.projectRoot, "apps/site"))).toBe(
				false,
			);
		});
	}, 120_000);

	it("reports an edited secondary package still in the workspace", async () => {
		await withScenarioWorkspace("remove-edited-package", async (workspace) => {
			await createProject(workspace, {
				packageManager: "pnpm",
				web: "nextjs",
				webApps: [{ name: "admin", framework: "nextjs" }],
			});

			const packagePath = join(
				workspace.projectRoot,
				"apps/admin/package.json",
			);
			const packageJson = await readJson<Record<string, unknown>>(packagePath);

			await writeJson(packagePath, { ...packageJson, custom: true });

			const removed = await tryRunForge(
				workspace.projectRoot,
				["remove", "admin"],
				{ workspaceRoot: workspace.workspaceRoot },
			);

			expect(removed.exitCode, removed.stdout + removed.stderr).toBe(0);
			expect(removed.stdout + removed.stderr).toContain(
				"apps/admin is still a workspace package, so delete the folder to finish the removal.",
			);
		});
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

	it("removes Oxc from every linter surface", async () => {
		await withScenarioWorkspace("remove-oxc", async (workspace) => {
			await createProject(workspace, {
				addons: ["github-ci", "lefthook", "vscode"],
				packageManager: "pnpm",
				web: "nextjs",
			});

			const surfaces = [
				".github/workflows/ci.yml",
				".vscode/extensions.json",
				".vscode/settings.json",
				"lefthook.yml",
				"package.json",
				"pnpm-workspace.yaml",
			];

			const readSurfaces = () =>
				Promise.all(
					surfaces.map((path) =>
						readFile(join(workspace.projectRoot, path), "utf-8"),
					),
				);

			const before = await readSurfaces();
			await addAddon(workspace.projectRoot, "oxc");

			for (const file of [".oxlintrc.json", ".oxfmtrc.json"])
				expect(await pathExists(join(workspace.projectRoot, file))).toBe(true);

			const rootAfterAdd = await readJson<PackageJson>(
				join(workspace.projectRoot, "package.json"),
			);

			expect(rootAfterAdd.devDependencies?.oxlint).toBe("catalog:");
			expect(rootAfterAdd.devDependencies?.oxfmt).toBe("catalog:");
			expect(rootAfterAdd.scripts?.check).toBe("oxlint && oxfmt --check");
			expect(
				await readFile(join(workspace.projectRoot, "lefthook.yml"), "utf-8"),
			).toContain("oxfmt");

			await removeAddon(workspace.projectRoot, "oxc");

			const manifest = await readJson<{
				config: { linter?: string };
				installs: Array<{ definitionId: string }>;
			}>(join(workspace.projectRoot, ".forge/manifest.json"));

			expect(
				manifest.installs.some((entry) => entry.definitionId === "oxc"),
			).toBe(false);

			expect(manifest.config.linter).toBe(undefined);

			for (const file of [".oxlintrc.json", ".oxfmtrc.json"])
				expect(await pathExists(join(workspace.projectRoot, file))).toBe(false);

			expect(await readSurfaces()).toEqual(before);
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
