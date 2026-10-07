import { readdir, readFile } from "node:fs/promises";
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

async function snapshotTree(root: string) {
	const entries = await readdir(root, { recursive: true, withFileTypes: true });
	const files = entries
		.filter((entry) => entry.isFile())
		.map((entry) => relative(root, join(entry.parentPath, entry.name)))
		.sort();

	return Object.fromEntries(
		await Promise.all(
			files.map(async (file) => [
				file,
				(await readFile(join(root, file))).toString("base64"),
			]),
		),
	);
}

async function rerunCreate(workspaceRoot: string) {
	const configPath = join(workspaceRoot, "forge.config.json");

	await writeJson(configPath, {
		name: "acme",
		packageManager: "pnpm",
		path: "./project",
		platforms: ["web"],
		slug: "acme",
		web: "nextjs",
	});

	return await tryRunForge(
		workspaceRoot,
		["create", "--config", configPath, "--no-install", "--no-git"],
		{ workspaceRoot },
	);
}

describe("create", () => {
	it("ends a non interactive create with the next commands", async () => {
		await withScenarioWorkspace("create-completion", async (workspace) => {
			const result = await createProject(workspace, {
				packageManager: "pnpm",
				web: "nextjs",
			});

			expect(result.stdout).toContain(
				'We created acme in ./project. Run "cd ./project", then "pnpm install" to install its dependencies.',
			);
		});
	}, 120_000);

	it("creates an opted-in admin with RPC and auth clients", async () => {
		await withScenarioWorkspace(
			"create-admin-api-client",
			async (workspace) => {
				await createProject(workspace, {
					web: "tanstack-router",
					backend: "hono",
					rpc: "trpc",
					authentication: "better-auth",
					orm: "drizzle",
					database: "sqlite",
					packageManager: "pnpm",
					webApps: [{ name: "admin", framework: "nextjs", client: true }],
				});

				const readText = (path: string) =>
					readFile(join(workspace.projectRoot, path), "utf8");

				expect(await readText("apps/admin/trpc/react.tsx")).toContain(
					"NEXT_PUBLIC_SERVER_URL",
				);

				expect(await readText("apps/admin/lib/auth-client.ts")).toContain(
					"env.NEXT_PUBLIC_SERVER_URL",
				);

				expect(await readText("apps/admin/app/providers.tsx")).toContain(
					"TRPCReactProvider",
				);

				expect(await readText("apps/server/src/routes/trpc.ts")).toContain(
					"origin: webOrigins,",
				);

				expect(await readText("apps/server/src/routes/auth.ts")).toContain(
					"origin: webOrigins,",
				);

				expect(await readText("packages/auth/src/index.ts")).toContain(
					"trustedOrigins: webOrigins,",
				);

				expect(
					await pathExists(join(workspace.projectRoot, "apps/admin/app/api")),
				).toBe(false);
			},
		);
	});

	it("points a self-hosted admin auth client at the primary origin", async () => {
		await withScenarioWorkspace(
			"create-self-admin-client",
			async (workspace) => {
				await createProject(workspace, {
					web: "nextjs",
					backend: "self",
					authentication: "better-auth",
					orm: "drizzle",
					database: "sqlite",
					packageManager: "pnpm",
					webApps: [{ name: "admin", framework: "nextjs", client: true }],
				});

				const readText = (path: string) =>
					readFile(join(workspace.projectRoot, path), "utf8");

				expect(await readText("apps/admin/env.ts")).toContain(
					'NEXT_PUBLIC_SERVER_URL:\n      process.env.NODE_ENV === "production"\n        ? z.url()\n        : z.url().default("http://localhost:3000")',
				);

				expect(await readText("apps/admin/lib/auth-client.ts")).toContain(
					"env.NEXT_PUBLIC_SERVER_URL",
				);

				expect(await readText("packages/auth/env.ts")).toContain(
					"export const webOrigins = originList({\n  APP_ORIGIN: env.APP_ORIGIN,\n  WEB_URLS: env.WEB_URLS,\n});",
				);

				expect(await readText("apps/web/lib/api-cors.ts")).toContain(
					'headers.set("Access-Control-Allow-Credentials", "true");',
				);

				expect(
					await pathExists(join(workspace.projectRoot, "apps/admin/app/api")),
				).toBe(false);
			},
		);
	});

	it.each([
		{ web: "nextjs", sourceRoot: "" },
		{ web: "react-router", sourceRoot: "app/" },
		{ web: "tanstack-start", sourceRoot: "src/" },
	])("creates $web with an oRPC Hono client", async ({ web, sourceRoot }) => {
		await withScenarioWorkspace(
			`create-orpc-hono-${web}`,
			async (workspace) => {
				await createProject(workspace, {
					backend: "hono",
					packageManager: "pnpm",
					rpc: "orpc",
					web,
				});

				const client = await readFile(
					join(workspace.projectRoot, `apps/web/${sourceRoot}orpc/client.ts`),
					"utf8",
				);

				expect(client).toContain(
					"export const client: RouterClient<AppRouter>",
				);

				expect(client).toContain("createTanstackQueryUtils(client)");
				expect(
					await pathExists(
						join(workspace.projectRoot, `apps/web/${sourceRoot}orpc/react.tsx`),
					),
				).toBe(true);
			},
		);
	});

	it("creates a Next.js secondary app with a TanStack Router primary", async () => {
		await withScenarioWorkspace(
			"create-mixed-secondary-web-app",
			async (workspace) => {
				await createProject(workspace, {
					web: "tanstack-router",
					backend: "hono",
					rpc: "trpc",
					authentication: "better-auth",
					orm: "drizzle",
					database: "sqlite",
					style: "tailwind",
					linter: "biome",
					packageManager: "pnpm",
					webApps: [{ name: "admin", framework: "nextjs" }],
				});

				const adminRoot = join(workspace.projectRoot, "apps/admin");
				const admin = await readJson<{ scripts: { dev: string } }>(
					join(adminRoot, "package.json"),
				);

				expect(await readJson(join(adminRoot, "forge.json"))).toHaveProperty(
					"framework",
					"nextjs",
				);

				expect(admin.scripts.dev).toBe("pnpm with-env next dev --port 3002");
				expect(
					await readJson(
						join(workspace.projectRoot, "packages/ui/components.json"),
					),
				).toHaveProperty("rsc", true);
			},
		);
	});

	it("creates a secondary web app without primary API wiring", async () => {
		await withScenarioWorkspace(
			"create-secondary-web-app",
			async (workspace) => {
				await createProject(workspace, {
					web: "tanstack-router",
					backend: "hono",
					rpc: "trpc",
					authentication: "better-auth",
					orm: "drizzle",
					database: "sqlite",
					style: "tailwind",
					linter: "biome",
					packageManager: "pnpm",
					webApps: [{ name: "admin", framework: "tanstack-router" }],
				});

				const adminRoot = join(workspace.projectRoot, "apps/admin");
				const webRoot = join(workspace.projectRoot, "apps/web");
				const admin = await readJson<{
					name: string;
					dependencies: Record<string, string>;
					scripts: { dev: string };
				}>(join(adminRoot, "package.json"));

				const web = await readJson<{
					dependencies: Record<string, string>;
					scripts: { dev: string };
				}>(join(webRoot, "package.json"));

				expect(await pathExists(adminRoot)).toBe(true);
				expect(admin.name).toBe("@acme/admin");
				expect(admin.scripts.dev).toBe("pnpm with-env vite dev --port 3002");
				expect(web.scripts.dev).toBe("pnpm with-env vite dev --port 3000");
				expect(await readJson(join(webRoot, "forge.json"))).toHaveProperty(
					"role",
					"primary",
				);

				expect(
					await readJson(join(adminRoot, "forge.json")),
				).not.toHaveProperty("role");

				for (const name of ["@acme/trpc", "@acme/auth", "@acme/db"])
					expect(admin.dependencies).not.toHaveProperty(name);

				expect(await pathExists(join(adminRoot, "src/trpc"))).toBe(false);
				expect(
					await pathExists(join(adminRoot, "src/lib/auth-client.ts")),
				).toBe(false);

				expect(
					await readFile(
						join(workspace.projectRoot, "apps/server/env.ts"),
						"utf8",
					),
				).not.toContain("WEB_URLS");

				expect(
					await readFile(
						join(workspace.projectRoot, "packages/auth/src/index.ts"),
						"utf8",
					),
				).not.toContain("WEB_URLS");

				expect(await pathExists(join(webRoot, "src/trpc/react.tsx"))).toBe(
					true,
				);

				expect(web.dependencies).toHaveProperty("@acme/trpc");
			},
		);
	});

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

	it("creates a standalone Express backend at its API slot paths", async () => {
		await withScenarioWorkspace("create-express", async (workspace) => {
			await createProject(workspace, {
				authentication: "better-auth",
				backend: "express",
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
				framework: "express",
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

	it("refuses a target that already holds a Forge project", async () => {
		await withScenarioWorkspace("create-occupied-forge", async (workspace) => {
			await createProject(workspace, {
				packageManager: "pnpm",
				web: "nextjs",
			});

			await runForge(
				workspace.projectRoot,
				["add", "lefthook", "--no-install"],
				{
					workspaceRoot: workspace.workspaceRoot,
				},
			);

			const before = await snapshotTree(workspace.projectRoot);
			expect(before["lefthook.yml"]).toBeDefined();

			const result = await rerunCreate(workspace.workspaceRoot);

			expect(result.exitCode).not.toBe(0);
			expect(result.stdout + result.stderr).toContain(
				'"./project" already holds a Forge project. Run forge add or forge update inside it instead.',
			);

			expect(await snapshotTree(workspace.projectRoot)).toEqual(before);
		});
	}, 120_000);

	it("refuses a target that holds the user's own files", async () => {
		await withScenarioWorkspace("create-occupied-user", async (workspace) => {
			await writeJson(join(workspace.projectRoot, "package.json"), {
				name: "mine",
			});

			const before = await snapshotTree(workspace.projectRoot);
			const result = await rerunCreate(workspace.workspaceRoot);
			const output = result.stdout + result.stderr;

			expect(result.exitCode).not.toBe(0);
			expect(output).toContain(
				'"./project" already holds package.json. Pick a new or empty directory, or run forge init inside it to adopt your project.',
			);

			expect(output).not.toMatch(
				/Generation Failed|--accept-forge|--keep-user/,
			);
			expect(await snapshotTree(workspace.projectRoot)).toEqual(before);
		});
	}, 120_000);
});
