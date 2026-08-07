import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import {
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
		scripts: { admin: "keep-me" },
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
