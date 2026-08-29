import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	createProject,
	pathExists,
	readJson,
	tryRunForge,
	withScenarioWorkspace,
	writeJson,
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
	it("creates a standalone Hono backend at its API slot paths", async () => {
		await withScenarioWorkspace("create-hono", async (workspace) => {
			await createProject(workspace, {
				authentication: "better-auth",
				backend: "hono",
				database: "sqlite",
				orm: "drizzle",
				packageManager: "pnpm",
				rpc: "trpc",
				web: "tanstack-router",
			});

			for (const path of [
				"src/app.ts",
				"src/index.ts",
				"src/routes/auth.ts",
				"src/routes/trpc.ts",
				"tsdown.config.ts",
			])
				expect(
					await pathExists(join(workspace.projectRoot, "apps/server", path)),
					path,
				).toBe(true);

			const serverConfig = await readJson<{
				framework: string;
				slots: Record<string, string>;
			}>(join(workspace.projectRoot, "apps/server/forge.json"));
			expect(serverConfig).toMatchObject({
				framework: "hono",
				slots: {
					auth: "src/routes/auth.ts",
					trpc: "src/routes/trpc.ts",
				},
			});
		});
	}, 240_000);

	it("creates a standalone Fastify backend at its API slot paths", async () => {
		await withScenarioWorkspace("create-fastify", async (workspace) => {
			await createProject(workspace, {
				authentication: "better-auth",
				backend: "fastify",
				database: "sqlite",
				orm: "drizzle",
				packageManager: "pnpm",
				rpc: "trpc",
				web: "tanstack-router",
			});

			for (const path of [
				"src/app.ts",
				"src/index.ts",
				"src/routes/auth.ts",
				"src/routes/trpc.ts",
				"tsdown.config.ts",
			])
				expect(
					await pathExists(join(workspace.projectRoot, "apps/server", path)),
					path,
				).toBe(true);

			const serverConfig = await readJson<{
				framework: string;
				slots: Record<string, string>;
			}>(join(workspace.projectRoot, "apps/server/forge.json"));
			expect(serverConfig).toMatchObject({
				framework: "fastify",
				slots: {
					auth: "src/routes/auth.ts",
					trpc: "src/routes/trpc.ts",
				},
			});
		});
	}, 240_000);

	it("creates a worker service alongside the web app", async () => {
		await withScenarioWorkspace("create-worker", async (workspace) => {
			await createProject(workspace, {
				addons: ["worker"],
				packageManager: "pnpm",
				web: "nextjs",
			});

			for (const path of [
				"env.ts",
				"src/app.ts",
				"src/index.ts",
				"src/run.ts",
				"tsdown.config.ts",
			])
				expect(
					await pathExists(join(workspace.projectRoot, "apps/worker", path)),
					path,
				).toBe(true);

			const workerConfig = await readJson<{
				framework: string;
				slots: Record<string, string>;
				type: string;
			}>(join(workspace.projectRoot, "apps/worker/forge.json"));
			expect(workerConfig).toMatchObject({
				framework: "hono",
				slots: {},
				type: "app",
			});

			const env = await readFile(join(workspace.projectRoot, ".env"), "utf-8");
			expect(env).toMatch(/WORKER_SECRET="[0-9a-f]{64}"/);
		});
	}, 240_000);

	it("creates an Expo app with tRPC and Better Auth clients", async () => {
		await withScenarioWorkspace("create-expo", async (workspace) => {
			await createProject(workspace, {
				authentication: "better-auth",
				backend: "hono",
				database: "sqlite",
				mobile: "expo",
				orm: "drizzle",
				packageManager: "pnpm",
				platforms: ["web", "mobile"],
				rpc: "trpc",
				style: "tailwind",
				web: "nextjs",
			});

			const mobileConfig = await readJson<{
				framework: string;
				slots: Record<string, string>;
				template: { id: string; version: number };
				type: string;
			}>(join(workspace.projectRoot, "apps/mobile/forge.json"));

			expect(mobileConfig).toMatchObject({
				framework: "expo",
				slots: {
					layout: "src/app/_layout.tsx",
					page: "src/app/index.tsx",
				},
				template: { id: "expo/base", version: 1 },
				type: "app",
			});

			for (const path of [
				"apps/mobile/app.json",
				"apps/mobile/src/app/_layout.tsx",
				"apps/mobile/src/lib/auth-client.ts",
				"apps/mobile/src/lib/trpc.ts",
				"tooling/tsconfig/expo.json",
			])
				expect(await pathExists(join(workspace.projectRoot, path)), path).toBe(
					true,
				);

			const env = await readFile(join(workspace.projectRoot, ".env"), "utf-8");
			expect(env).toContain('EXPO_PUBLIC_SERVER_URL="http://localhost:3001"');
		});
	}, 240_000);

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
			const gitignore = await readFile(
				join(workspace.projectRoot, ".gitignore"),
				"utf-8",
			);

			const appConfig = await readJson<{
				framework: string;
				type: string;
			}>(join(workspace.projectRoot, "apps/web/forge.json"));

			const uiConfig = await readJson<{
				packageType: string;
				type: string;
			}>(join(workspace.projectRoot, "packages/ui/forge.json"));

			expect(manifest.config.slug).toBe("acme");
			expect(gitignore).not.toContain(".forge/");
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

	it("creates a React Router workspace at its framework slot paths", async () => {
		await withScenarioWorkspace("create-react-router", async (workspace) => {
			await createProject(workspace, {
				authentication: "better-auth",
				database: "postgresql",
				linter: "biome",
				orm: "drizzle",
				packageManager: "pnpm",
				rpc: "trpc",
				style: "tailwind",
				web: "react-router",
			});

			for (const path of [
				"app/root.tsx",
				"app/routes/home.tsx",
				"app/routes/api.trpc.$.ts",
				"app/routes/api.auth.$.ts",
				"app/routes.ts",
				"react-router.config.ts",
				"vite.config.ts",
			])
				expect(
					await pathExists(join(workspace.projectRoot, "apps/web", path)),
					path,
				).toBe(true);

			const appConfig = await readJson<{
				framework: string;
				slots: Record<string, string>;
			}>(join(workspace.projectRoot, "apps/web/forge.json"));
			expect(appConfig).toMatchObject({
				framework: "react-router",
				slots: {
					auth: "app/routes/api.auth.$.ts",
					layout: "app/root.tsx",
					page: "app/routes/home.tsx",
					trpc: "app/routes/api.trpc.$.ts",
				},
			});
		});
	}, 240_000);

	it("creates a TanStack Router SPA workspace at its two-slot paths", async () => {
		await withScenarioWorkspace("create-tanstack-router", async (workspace) => {
			await createProject(workspace, {
				linter: "biome",
				packageManager: "pnpm",
				style: "tailwind",
				web: "tanstack-router",
			});

			for (const path of [
				"index.html",
				"src/main.tsx",
				"src/router.tsx",
				"src/routeTree.gen.ts",
				"src/routes/__root.tsx",
				"src/routes/index.tsx",
				"vite.config.ts",
			])
				expect(
					await pathExists(join(workspace.projectRoot, "apps/web", path)),
					path,
				).toBe(true);

			for (const path of [
				"src/routes/api",
				"src/routes/api/trpc/$.ts",
				"src/routes/api/auth/$.ts",
			])
				expect(
					await pathExists(join(workspace.projectRoot, "apps/web", path)),
					path,
				).toBe(false);

			const appConfig = await readJson<{
				framework: string;
				slots: Record<string, string>;
			}>(join(workspace.projectRoot, "apps/web/forge.json"));
			expect(appConfig.framework).toBe("tanstack-router");
			expect(appConfig.slots).toEqual({
				layout: "src/routes/__root.tsx",
				page: "src/routes/index.tsx",
			});
		});
	}, 240_000);

	it("rejects tRPC configs for TanStack Router before generating anything", async () => {
		await withScenarioWorkspace(
			"create-tanstack-router-trpc",
			async (workspace) => {
				await expect(
					createProject(workspace, {
						linter: "biome",
						orm: "drizzle",
						packageManager: "pnpm",
						rpc: "trpc",
						style: "tailwind",
						web: "tanstack-router",
					}),
				).rejects.toThrow(
					"tRPC needs a backend. TanStack Router can't host it; add a backend framework.",
				);

				expect(await readdir(workspace.projectRoot)).toEqual([]);
			},
		);
	}, 120_000);

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

	it("rejects config files that select unavailable platforms", async () => {
		await withScenarioWorkspace(
			"create-unavailable-platform",
			async (workspace) => {
				const configPath = join(workspace.workspaceRoot, "forge.config.json");

				await writeJson(configPath, {
					name: "acme",
					path: "./project",
					platforms: ["web", "desktop"],
					slug: "acme",
					web: "nextjs",
				});

				const result = await tryRunForge(
					workspace.workspaceRoot,
					["create", "--config", configPath, "--no-install", "--no-git"],
					{ workspaceRoot: workspace.workspaceRoot },
				);

				expect(result.exitCode).not.toBe(0);
				expect(result.stdout + result.stderr).toContain(
					"We don't support Desktop yet.",
				);
			},
		);
	}, 120_000);
});
