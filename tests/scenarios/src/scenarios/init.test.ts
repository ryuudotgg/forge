import {
	mkdir,
	readdir,
	readFile,
	rename,
	rm,
	writeFile,
} from "node:fs/promises";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import {
	createProject,
	pathExists,
	readJson,
	runForge,
	tryRunForge,
	withScenarioWorkspace,
	writeJson,
} from "../utils/harness";

async function fixture(projectRoot: string) {
	const secret = "DATABASE_URL=super-secret-init-value\n";
	await writeJson(join(projectRoot, "package.json"), {
		name: "ajito-shaped",
		private: true,
		scripts: { user: "keep-me" },
	});

	await writeFile(
		join(projectRoot, "pnpm-workspace.yaml"),
		"packages:\n  - 'apps/*'\n  - 'packages/*'\n",
		"utf-8",
	);

	await writeFile(
		join(projectRoot, "pnpm-lock.yaml"),
		"lockfileVersion: '9.0'\n",
		"utf-8",
	);

	await writeFile(join(projectRoot, ".env"), secret, "utf-8");
	await writeJson(join(projectRoot, "apps/api/package.json"), {
		dependencies: { hono: "^4.0.0" },
		name: "@ajito/api",
		private: true,
	});

	await writeJson(join(projectRoot, "apps/mobile/package.json"), {
		dependencies: { expo: "^54.0.0" },
		name: "@ajito/mobile",
		private: true,
	});

	await writeJson(join(projectRoot, "apps/web/package.json"), {
		dependencies: {
			next: "^16.0.0",
			react: "^19.0.0",
			"react-dom": "^19.0.0",
		},
		name: "@ajito/web",
		private: true,
		scripts: { custom: "keep-me" },
	});

	await mkdir(join(projectRoot, "apps/web/app"), { recursive: true });
	await writeFile(
		join(projectRoot, "apps/web/app/page.tsx"),
		"export default function Page() { return <main>User page</main>; }\n",
		"utf-8",
	);

	await writeFile(
		join(projectRoot, "apps/web/app/layout.tsx"),
		"export default function Layout({ children }: { children: unknown }) { return children; }\n",
		"utf-8",
	);

	await writeJson(join(projectRoot, "apps/admin/package.json"), {
		dependencies: {
			next: "^16.0.0",
			react: "^19.0.0",
			"react-dom": "^19.0.0",
		},
		name: "@ajito/admin",
		private: true,
		scripts: { admin: "keep-me", dev: "next dev --port 3002" },
	});

	await mkdir(join(projectRoot, "apps/admin/app"), { recursive: true });
	await writeFile(
		join(projectRoot, "apps/admin/app/page.tsx"),
		"export default function Page() { return <main>Admin page</main>; }\n",
		"utf-8",
	);

	await writeFile(
		join(projectRoot, "apps/admin/app/layout.tsx"),
		"export default function Layout({ children }: { children: unknown }) { return children; }\n",
		"utf-8",
	);

	await writeJson(join(projectRoot, "packages/db/package.json"), {
		dependencies: { "drizzle-orm": "1.0.0-rc.4" },
		name: "@ajito/db",
		private: true,
	});

	return secret;
}

async function snapshotTree(projectRoot: string) {
	const snapshot = new Map<string, string>();
	const visit = async (directory: string): Promise<void> => {
		for (const entry of await readdir(directory, { withFileTypes: true })) {
			const path = join(directory, entry.name);
			const fromRoot = relative(projectRoot, path).split("\\").join("/");
			if (fromRoot === ".forge" || fromRoot.startsWith(".forge/")) continue;
			if (entry.name === "forge.json") continue;
			if (entry.isDirectory()) await visit(path);
			else snapshot.set(fromRoot, await readFile(path, "utf-8"));
		}
	};

	await visit(projectRoot);
	return snapshot;
}

async function treeContents(projectRoot: string) {
	const contents: Record<string, string> = {};
	for (const entry of await readdir(projectRoot, {
		recursive: true,
		withFileTypes: true,
	})) {
		if (!entry.isFile()) continue;
		const path = join(entry.parentPath, entry.name);
		contents[relative(projectRoot, path)] = await readFile(path, "utf-8");
	}

	return contents;
}

function withoutForgeState(contents: Readonly<Record<string, string>>) {
	return Object.fromEntries(
		Object.entries(contents).filter(
			([path]) => !path.startsWith(".forge/") && !path.endsWith("forge.json"),
		),
	);
}

async function stripForgeState(projectRoot: string) {
	await rm(join(projectRoot, ".forge"), { recursive: true });

	for (const path of Object.keys(await treeContents(projectRoot)))
		if (path.endsWith("forge.json")) await rm(join(projectRoot, path));
}

function printedConfig(output: string) {
	const lines = output.split("\n");
	const start = lines.findIndex((line) =>
		line.includes("Forge will record this config:"),
	);

	const body: string[] = [];
	for (const line of lines.slice(start + 1)) {
		if (line.startsWith("├")) break;
		body.push(line.replace(/^│ {2}/, "").replace(/\s*│\s*$/, ""));
	}

	return JSON.parse(body.join("\n"));
}

async function initConfig(
	workspaceRoot: string,
	addons: ReadonlyArray<string> = [],
) {
	const path = join(workspaceRoot, "forge.init.json");
	await writeJson(path, {
		addons,
		catalogs: "flat",
		database: "sqlite",
		linter: "biome",
		modules: [
			{ kind: "web-app", root: "apps/admin" },
			{ kind: "web-app", root: "apps/web" },
			{ kind: "db", root: "packages/db" },
		],
		name: "Ajito",
		orm: "drizzle",
		packageManager: "pnpm",
		path: ".",
		platforms: ["web"],
		runtime: "Node.js",
		slug: "ajito",
		web: "nextjs",
	});

	return path;
}

describe("init", () => {
	it("adopts state-only, reconciles additively, and supports add", async () => {
		await withScenarioWorkspace("init-adoption", async (workspace) => {
			const secret = await fixture(workspace.projectRoot);
			const configPath = await initConfig(workspace.workspaceRoot);
			const before = await snapshotTree(workspace.projectRoot);

			const dryRun = await runForge(
				workspace.projectRoot,
				["init", "--config", configPath, "--dry-run"],
				{ workspaceRoot: workspace.workspaceRoot },
			);

			expect(dryRun.stdout + dryRun.stderr).toMatch(
				/Write marker:\s+apps\/web\/forge\.json/,
			);

			expect(dryRun.stdout + dryRun.stderr).toMatch(
				/Write marker:\s+apps\/admin\/forge\.json/,
			);

			expect(await snapshotTree(workspace.projectRoot)).toEqual(before);
			expect(await pathExists(join(workspace.projectRoot, ".forge"))).toBe(
				false,
			);

			await runForge(workspace.projectRoot, ["init", "--config", configPath], {
				workspaceRoot: workspace.workspaceRoot,
			});

			expect(await snapshotTree(workspace.projectRoot)).toEqual(before);
			expect(
				await pathExists(join(workspace.projectRoot, ".forge/manifest.json")),
			).toBe(true);

			const manifest = await readJson<{
				modules: Record<string, { root: string }>;
			}>(join(workspace.projectRoot, ".forge/manifest.json"));

			expect(
				Object.values(manifest.modules)
					.map((module) => module.root)
					.sort(),
			).toEqual(["apps/admin", "apps/web", "packages/db"]);

			const bases = await readdir(join(workspace.projectRoot, ".forge/bases"));
			const baseContents = await Promise.all(
				bases.map((base) =>
					readFile(join(workspace.projectRoot, ".forge/bases", base), "utf-8"),
				),
			);

			expect(baseContents.join("\n")).not.toContain(secret.trim());
			expect(await readFile(join(workspace.projectRoot, ".env"), "utf-8")).toBe(
				secret,
			);

			expect(
				await pathExists(join(workspace.projectRoot, "apps/web/forge.json")),
			).toBe(true);

			expect(
				await pathExists(join(workspace.projectRoot, "apps/admin/forge.json")),
			).toBe(true);

			expect(
				await pathExists(join(workspace.projectRoot, "apps/api/forge.json")),
			).toBe(false);

			expect(
				await pathExists(join(workspace.projectRoot, "apps/mobile/forge.json")),
			).toBe(false);

			const pagePath = join(workspace.projectRoot, "apps/web/app/page.tsx");
			const layoutPath = join(workspace.projectRoot, "apps/web/app/layout.tsx");
			const page = await readFile(pagePath, "utf-8");
			const layout = await readFile(layoutPath, "utf-8");
			const adminPagePath = join(
				workspace.projectRoot,
				"apps/admin/app/page.tsx",
			);

			const adminPage = await readFile(adminPagePath, "utf-8");
			await runForge(workspace.projectRoot, ["update", "--keep-user"], {
				workspaceRoot: workspace.workspaceRoot,
			});

			const updatedLockfile = await readJson<{
				artifacts: Record<string, { path: string }>;
			}>(join(workspace.projectRoot, ".forge/lock.json"));

			expect(
				Object.values(updatedLockfile.artifacts).some(
					(artifact) => artifact.path === ".env",
				),
			).toBe(false);

			expect(
				Object.keys(updatedLockfile.artifacts).some((artifactId) =>
					artifactId.endsWith(":rootEnv"),
				),
			).toBe(false);

			expect(await readFile(pagePath, "utf-8")).toBe(page);
			expect(await readFile(layoutPath, "utf-8")).toBe(layout);
			expect(await readFile(adminPagePath, "utf-8")).toBe(adminPage);
			const rootPackage = await readJson<{
				scripts: Record<string, string>;
			}>(join(workspace.projectRoot, "package.json"));

			const webPackage = await readJson<{
				scripts: Record<string, string>;
			}>(join(workspace.projectRoot, "apps/web/package.json"));

			const adminPackage = await readJson<{
				scripts: Record<string, string>;
			}>(join(workspace.projectRoot, "apps/admin/package.json"));

			expect(rootPackage.scripts.user).toBe("keep-me");
			expect(rootPackage.scripts.build).toBe("turbo run build");

			expect(webPackage.scripts.custom).toBe("keep-me");
			expect(webPackage.scripts.dev).toContain("next dev");

			expect(adminPackage.scripts.admin).toBe("keep-me");
			expect(adminPackage.scripts.dev).toContain("next dev");
			expect(
				await pathExists(
					join(workspace.projectRoot, "apps/web/components.json"),
				),
			).toBe(true);

			expect(
				await pathExists(
					join(workspace.projectRoot, "apps/admin/components.json"),
				),
			).toBe(true);

			await runForge(
				workspace.projectRoot,
				["add", "commitlint", "--no-install"],
				{ workspaceRoot: workspace.workspaceRoot },
			);

			expect(
				await pathExists(join(workspace.projectRoot, "commitlint.config.ts")),
			).toBe(true);

			const repeated = await tryRunForge(
				workspace.projectRoot,
				["init", "--config", configPath],
				{ workspaceRoot: workspace.workspaceRoot },
			);

			expect(repeated.exitCode).toBe(1);
			expect(repeated.stdout + repeated.stderr).toContain(
				'A ".forge" directory already exists here. You need to remove it before running forge init.',
			);
		});
	}, 120_000);

	it.each(["trpc", "orpc"])(
		"adopts a detected multi app tree with %s clients and converges",
		async (rpc) => {
			await withScenarioWorkspace(`init-detected-${rpc}`, async (workspace) => {
				await createProject(workspace, {
					backend: "self",
					packageManager: "pnpm",
					rpc,
					web: "nextjs",
					webApps: [
						{ name: "site", framework: "react-router", client: true },
						{ name: "admin", framework: "nextjs" },
					],
				});

				await stripForgeState(workspace.projectRoot);
				const before = await treeContents(workspace.projectRoot);
				const options = { workspaceRoot: workspace.workspaceRoot };
				const sentence =
					"We'll adopt admin (Next.js, port 3003) and site (React Router, port 3002, calls the API) as secondary web apps.";

				const dryRun = await runForge(
					workspace.projectRoot,
					["init", "--dry-run", "--yes"],
					options,
				);

				expect(dryRun.stdout + dryRun.stderr).toContain(sentence);
				expect(await treeContents(workspace.projectRoot)).toEqual(before);

				const adopted = await runForge(
					workspace.projectRoot,
					["init", "--yes"],
					options,
				);

				const manifest = await readJson<{
					config: { webApps?: ReadonlyArray<Record<string, unknown>> };
				}>(join(workspace.projectRoot, ".forge/manifest.json"));

				expect(printedConfig(dryRun.stdout)).toEqual(manifest.config);
				expect(printedConfig(adopted.stdout)).toEqual(manifest.config);
				expect(manifest.config).toMatchObject({ rpc, web: "nextjs" });
				expect(manifest.config.webApps).toEqual([
					{ name: "admin", framework: "nextjs", port: 3003 },
					{ name: "site", framework: "react-router", port: 3002, client: true },
				]);

				for (const [root, framework] of [
					["apps/web", "nextjs"],
					["apps/admin", "nextjs"],
					["apps/site", "react-router"],
				] satisfies ReadonlyArray<readonly [string, string]>)
					expect(
						await readJson<{ framework: string }>(
							join(workspace.projectRoot, root, "forge.json"),
						),
					).toMatchObject({ framework });

				for (const round of [1, 2]) {
					const update = await tryRunForge(
						workspace.projectRoot,
						["update", "--accept-forge", "--no-install"],
						options,
					);

					expect(update.exitCode, `round ${round}: ${update.stderr}`).toBe(0);
					expect(
						withoutForgeState(await treeContents(workspace.projectRoot)),
					).toEqual(before);
				}
			});
		},
		120_000,
	);

	it("refuses to pick a primary web app without apps/web under --yes", async () => {
		await withScenarioWorkspace("init-no-primary", async (workspace) => {
			await createProject(workspace, {
				packageManager: "pnpm",
				web: "nextjs",
				webApps: [{ name: "site", framework: "react-router" }],
			});

			await stripForgeState(workspace.projectRoot);
			await rename(
				join(workspace.projectRoot, "apps/web"),
				join(workspace.projectRoot, "apps/main"),
			);

			const before = await treeContents(workspace.projectRoot);
			const refused = await tryRunForge(
				workspace.projectRoot,
				["init", "--yes"],
				{ workspaceRoot: workspace.workspaceRoot },
			);

			expect(refused.exitCode).toBe(1);
			expect(refused.stdout + refused.stderr).toContain(
				"We couldn't choose a primary web app because apps/web isn't being adopted. Run forge init interactively and choose one.",
			);

			expect(await treeContents(workspace.projectRoot)).toEqual(before);
		});
	}, 120_000);

	it("refuses same-framework apps that a later update could not bind", async () => {
		await withScenarioWorkspace(
			"init-unbound-secondaries",
			async (workspace) => {
				const { projectRoot } = workspace;
				await writeJson(join(projectRoot, "package.json"), {
					name: "acme",
					private: true,
				});

				await writeFile(
					join(projectRoot, "pnpm-workspace.yaml"),
					"packages:\n  - 'apps/*'\n",
					"utf-8",
				);

				for (const [root, name, port] of [
					["apps/web", "@acme/web", undefined],
					["apps/marketing", "@company/site", 3002],
					["apps/console", "@company/admin", 3003],
				] satisfies ReadonlyArray<
					readonly [string, string, number | undefined]
				>)
					await writeJson(join(projectRoot, root, "package.json"), {
						dependencies: { next: "^16.0.0" },
						name,
						...(port === undefined
							? {}
							: { scripts: { dev: `next dev --port ${port}` } }),
					});

				const before = await treeContents(projectRoot);
				const refused = await tryRunForge(projectRoot, ["init", "--yes"], {
					workspaceRoot: workspace.workspaceRoot,
				});

				expect(refused.exitCode).toBe(1);
				expect(refused.stdout + refused.stderr).toContain(
					"We couldn't adopt apps/console and apps/marketing because Forge tells web apps of the same framework apart only by their folder or package, and these match neither. On the next update it would look for admin at apps/admin or as @acme/admin and site at apps/site or as @acme/site. Move each app to apps/<its name> or rename its package to @acme/<its name>, then run forge init again.",
				);

				expect(await treeContents(projectRoot)).toEqual(before);
			},
		);
	}, 120_000);

	it("refuses a secondary on the port Forge runs the primary on", async () => {
		await withScenarioWorkspace("init-primary-port", async (workspace) => {
			const { projectRoot } = workspace;
			await writeJson(join(projectRoot, "package.json"), {
				name: "acme",
				private: true,
			});

			await writeFile(
				join(projectRoot, "pnpm-workspace.yaml"),
				"packages:\n  - 'apps/*'\n",
				"utf-8",
			);

			for (const [app, dev] of [
				["web", "next dev -p 4000"],
				["site", "next dev --port 3000"],
			])
				await writeJson(join(projectRoot, `apps/${app}/package.json`), {
					dependencies: { next: "^16.0.0" },
					name: `@acme/${app}`,
					scripts: { dev },
				});

			const before = await treeContents(projectRoot);
			const refused = await tryRunForge(projectRoot, ["init", "--yes"], {
				workspaceRoot: workspace.workspaceRoot,
			});

			expect(refused.exitCode).toBe(1);
			expect(refused.stdout + refused.stderr).toContain(
				"We couldn't adopt apps/site on port 3000 because Forge runs the primary web app on port 3000. Give apps/site another port in its dev script and run forge init again.",
			);

			expect(await treeContents(projectRoot)).toEqual(before);
		});
	}, 120_000);

	it("requires explicit consent to remove an adopted addon artifact", async () => {
		await withScenarioWorkspace("init-adopted-remove", async (workspace) => {
			await fixture(workspace.projectRoot);
			const adoptedPath = join(workspace.projectRoot, "commitlint.config.ts");
			await writeFile(
				adoptedPath,
				'export default { extends: ["@commitlint/config-conventional"] };\n',
				"utf-8",
			);

			const configPath = await initConfig(workspace.workspaceRoot, [
				"commitlint",
			]);

			await runForge(workspace.projectRoot, ["init", "--config", configPath], {
				workspaceRoot: workspace.workspaceRoot,
			});

			const refused = await tryRunForge(
				workspace.projectRoot,
				["remove", "commitlint"],
				{ workspaceRoot: workspace.workspaceRoot },
			);

			expect(refused.exitCode).toBe(1);
			expect(refused.stdout + refused.stderr).toContain(
				"Run again with --accept-forge to remove",
			);

			expect(await pathExists(adoptedPath)).toBe(true);

			await runForge(
				workspace.projectRoot,
				["remove", "commitlint", "--accept-forge"],
				{ workspaceRoot: workspace.workspaceRoot },
			);

			expect(await pathExists(adoptedPath)).toBe(false);
		});
	}, 120_000);

	it("refuses a rejected module that the confirmed graph requires", async () => {
		await withScenarioWorkspace(
			"init-required-rejection",
			async (workspace) => {
				await fixture(workspace.projectRoot);
				await writeJson(
					join(workspace.projectRoot, "packages/ui/package.json"),
					{
						dependencies: { "@base-ui/react": "^1.0.0" },
						name: "@ajito/ui",
						private: true,
					},
				);

				const configPath = await initConfig(workspace.workspaceRoot);
				const result = await tryRunForge(
					workspace.projectRoot,
					["init", "--config", configPath],
					{ workspaceRoot: workspace.workspaceRoot },
				);

				expect(result.exitCode).toBe(1);
				expect(result.stdout + result.stderr).toContain(
					'We can\'t leave "packages/ui" unmanaged because the confirmed configuration requires a ui module there.',
				);

				expect(await pathExists(join(workspace.projectRoot, ".forge"))).toBe(
					false,
				);
			},
		);
	}, 120_000);

	it("records Oxc as the linter when both Oxc configs are present", async () => {
		await withScenarioWorkspace("init-oxc", async (workspace) => {
			await fixture(workspace.projectRoot);
			await writeJson(join(workspace.projectRoot, ".oxlintrc.json"), {});
			await writeJson(join(workspace.projectRoot, ".oxfmtrc.json"), {});

			const configPath = await initConfig(workspace.workspaceRoot);
			const { linter: _linter, ...detectedLinter } =
				await readJson<Record<string, unknown>>(configPath);

			await writeJson(configPath, detectedLinter);
			await runForge(workspace.projectRoot, ["init", "--config", configPath], {
				workspaceRoot: workspace.workspaceRoot,
			});

			const manifest = await readJson<{
				readonly config: { readonly linter?: string };
			}>(join(workspace.projectRoot, ".forge/manifest.json"));

			expect(manifest.config.linter).toBe("oxc");
		});
	}, 120_000);

	it("surfaces the ordinary resolution guidance for an opaque file", async () => {
		await withScenarioWorkspace("init-opaque", async (workspace) => {
			await fixture(workspace.projectRoot);
			const configPath = await initConfig(workspace.workspaceRoot);
			await runForge(workspace.projectRoot, ["init", "--config", configPath], {
				workspaceRoot: workspace.workspaceRoot,
			});

			const update = await tryRunForge(workspace.projectRoot, ["update"], {
				workspaceRoot: workspace.workspaceRoot,
			});

			expect(update.exitCode).toBe(1);
			const output = update.stdout + update.stderr;
			expect(output).toContain("was modified after Forge last managed it");
			expect(output).toContain("--keep-user");
			expect(output).toContain("--accept-forge");
		});
	}, 120_000);

	it("chains the ordinary update flow with reconcile flags", async () => {
		await withScenarioWorkspace("init-reconcile", async (workspace) => {
			await fixture(workspace.projectRoot);
			const configPath = await initConfig(workspace.workspaceRoot);
			const pagePath = join(workspace.projectRoot, "apps/web/app/page.tsx");
			const page = await readFile(pagePath, "utf-8");

			await runForge(
				workspace.projectRoot,
				["init", "--config", configPath, "--reconcile", "--keep-user"],
				{ workspaceRoot: workspace.workspaceRoot },
			);

			expect(await readFile(pagePath, "utf-8")).toBe(page);
			const packageJson = await readJson<{
				scripts: Record<string, string>;
			}>(join(workspace.projectRoot, "package.json"));

			expect(packageJson.scripts.user).toBe("keep-me");
			expect(packageJson.scripts.build).toBe("turbo run build");
		});
	}, 120_000);
});
