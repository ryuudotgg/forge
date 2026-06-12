import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	createProject,
	pathExists,
	readJson,
	withScenarioWorkspace,
} from "../utils/harness";

const baseConfig = {
	addons: ["commitlint", "github-ci", "lefthook"],
	linter: "biome",
	orm: "drizzle",
	rpc: "trpc",
	style: "tailwind",
	web: "nextjs",
};

interface PackageJson {
	readonly dependencies?: Record<string, string>;
	readonly devDependencies?: Record<string, string>;
	readonly scripts?: Record<string, string>;
	readonly trustedDependencies?: ReadonlyArray<string>;
	readonly workspaces?: ReadonlyArray<string>;
}

function dependencyValues(pkg: PackageJson): ReadonlyArray<string> {
	return [
		...Object.values(pkg.dependencies ?? {}),
		...Object.values(pkg.devDependencies ?? {}),
	];
}

const coreManifestPaths = [
	"package.json",
	"apps/web/package.json",
	"packages/db/package.json",
	"packages/trpc/package.json",
	"packages/ui/package.json",
];

interface WorkspaceManifest {
	readonly path: string;
	readonly pkg: PackageJson;
}

async function readWorkspaceManifests(
	projectRoot: string,
): Promise<ReadonlyArray<WorkspaceManifest>> {
	const manifests: WorkspaceManifest[] = [
		{
			path: "package.json",
			pkg: await readJson<PackageJson>(join(projectRoot, "package.json")),
		},
	];

	for (const group of ["apps", "packages", "tooling"]) {
		const entries = await readdir(join(projectRoot, group), {
			withFileTypes: true,
		});

		for (const entry of entries) {
			if (!entry.isDirectory()) continue;

			const manifestPath = join(group, entry.name, "package.json");
			if (await pathExists(join(projectRoot, manifestPath)))
				manifests.push({
					path: manifestPath,
					pkg: await readJson<PackageJson>(join(projectRoot, manifestPath)),
				});
		}
	}

	return manifests;
}

function expectResolvedDependencies(
	manifests: ReadonlyArray<WorkspaceManifest>,
	options: { readonly allowWorkspaceProtocol: boolean },
) {
	expect(manifests.map((manifest) => manifest.path)).toEqual(
		expect.arrayContaining(coreManifestPaths),
	);

	for (const { path, pkg } of manifests) {
		const values = dependencyValues(pkg);
		if (coreManifestPaths.includes(path))
			expect(values.length, path).toBeGreaterThan(0);

		for (const value of values) {
			expect(value, path).not.toMatch(/^catalog:/);
			if (!options.allowWorkspaceProtocol)
				expect(value, path).not.toMatch(/^workspace:/);
		}
	}
}

interface PrismaCell {
	readonly dbDependency: string;
	readonly dbGenerate: string;
	readonly migrate: string;
	readonly pm: string;
	readonly postinstall: string;
	readonly trustedDependencies?: ReadonlyArray<string>;
}

const prismaCells: ReadonlyArray<PrismaCell> = [
	{
		dbDependency: "*",
		dbGenerate: "npm run generate --prefix ../../packages/db",
		migrate: "npm run with-env -- prisma migrate dev",
		pm: "npm",
		postinstall: "npm run generate --prefix packages/db",
	},
	{
		dbDependency: "workspace:*",
		dbGenerate: "yarn workspace @acme/db generate",
		migrate: "yarn with-env prisma migrate dev",
		pm: "Yarn",
		postinstall: "yarn workspace @acme/db generate",
	},
	{
		dbDependency: "workspace:*",
		dbGenerate: "bun --filter @acme/db generate",
		migrate: "bun run with-env prisma migrate dev",
		pm: "Bun",
		postinstall: "bun --filter @acme/db generate",
		trustedDependencies: [
			"@prisma/engines",
			"esbuild",
			"lefthook",
			"msw",
			"prisma",
			"sharp",
		],
	},
];

describe("multi-pm", () => {
	it("keeps pnpm projects on the workspace catalog", async () => {
		await withScenarioWorkspace("multi-pm-pnpm", async (workspace) => {
			await createProject(workspace, {
				...baseConfig,
				packageManager: "pnpm",
			});

			const root = await readJson<PackageJson>(
				join(workspace.projectRoot, "package.json"),
			);
			const web = await readJson<PackageJson>(
				join(workspace.projectRoot, "apps/web/package.json"),
			);
			const workspaceYaml = await readFile(
				join(workspace.projectRoot, "pnpm-workspace.yaml"),
				"utf-8",
			);

			expect(root.workspaces).toBeUndefined();
			expect(root.trustedDependencies).toBeUndefined();
			expect(workspaceYaml).toContain("catalog:");
			expect(workspaceYaml).toMatch(/^ {2}next: \d/m);
			expect(workspaceYaml).toContain("allowBuilds:");
			expect(workspaceYaml).toContain("  esbuild: true");
			expect(workspaceYaml).toContain("  lefthook: true");
			expect(web.dependencies?.next).toBe("catalog:");
			expect(web.dependencies?.["@acme/ui"]).toBe("workspace:*");
			expect(web.scripts?.build).toBe("pnpm with-env next build");
			expect(web.scripts?.["db:generate"]).toBe(
				"pnpm --filter @acme/db run generate",
			);
		});
	}, 240_000);

	it("generates npm projects with explicit versions and npm scripts", async () => {
		await withScenarioWorkspace("multi-pm-npm", async (workspace) => {
			await createProject(workspace, {
				...baseConfig,
				packageManager: "npm",
			});

			const root = await readJson<PackageJson>(
				join(workspace.projectRoot, "package.json"),
			);
			const web = await readJson<PackageJson>(
				join(workspace.projectRoot, "apps/web/package.json"),
			);
			const db = await readJson<PackageJson>(
				join(workspace.projectRoot, "packages/db/package.json"),
			);
			const lefthook = await readFile(
				join(workspace.projectRoot, "lefthook.yml"),
				"utf-8",
			);
			const setupAction = await readFile(
				join(workspace.projectRoot, "tooling/github/setup/action.yml"),
				"utf-8",
			);

			expect(root.workspaces).toEqual(["apps/*", "packages/*", "tooling/*"]);
			expect(
				await pathExists(join(workspace.projectRoot, "pnpm-workspace.yaml")),
			).toBe(false);

			expectResolvedDependencies(
				await readWorkspaceManifests(workspace.projectRoot),
				{ allowWorkspaceProtocol: false },
			);

			expect(web.dependencies?.["@acme/ui"]).toBe("*");
			expect(web.scripts?.build).toBe("npm run with-env -- next build");
			expect(web.scripts?.["db:generate"]).toBe(
				"npm run generate --prefix ../../packages/db",
			);
			expect(db.scripts?.generate).toBe(
				"npm run with-env -- drizzle-kit generate",
			);
			expect(lefthook).toContain("npx commitlint --edit {1}");
			expect(lefthook).toContain(
				"npm run check:fix -- --staged --no-errors-on-unmatched",
			);
			expect(setupAction).toContain("npm ci");
			expect(setupAction).toContain('cache: "npm"');
		});
	}, 240_000);

	it("generates yarn projects with the node-modules linker and yarn scripts", async () => {
		await withScenarioWorkspace("multi-pm-yarn", async (workspace) => {
			await createProject(workspace, {
				...baseConfig,
				packageManager: "Yarn",
			});

			const root = await readJson<PackageJson>(
				join(workspace.projectRoot, "package.json"),
			);
			const web = await readJson<PackageJson>(
				join(workspace.projectRoot, "apps/web/package.json"),
			);
			const yarnrc = await readFile(
				join(workspace.projectRoot, ".yarnrc.yml"),
				"utf-8",
			);
			const gitignore = await readFile(
				join(workspace.projectRoot, ".gitignore"),
				"utf-8",
			);
			const setupAction = await readFile(
				join(workspace.projectRoot, "tooling/github/setup/action.yml"),
				"utf-8",
			);

			expect(root.workspaces).toEqual(["apps/*", "packages/*", "tooling/*"]);
			expect(
				await pathExists(join(workspace.projectRoot, "pnpm-workspace.yaml")),
			).toBe(false);
			expect(yarnrc).toBe("nodeLinker: node-modules\n");
			expect(gitignore).toContain(".pnp.*");
			expect(gitignore).toContain(".yarn/*");
			expect(gitignore).toContain("!.yarn/patches");
			expect(web.dependencies?.["@acme/ui"]).toBe("workspace:*");
			expect(web.dependencies?.next).toMatch(/^\d/);
			expectResolvedDependencies(
				await readWorkspaceManifests(workspace.projectRoot),
				{ allowWorkspaceProtocol: true },
			);
			expect(web.scripts?.build).toBe("yarn with-env next build");
			expect(web.scripts?.["db:generate"]).toBe(
				"yarn workspace @acme/db generate",
			);
			expect(setupAction).toContain("yarn install --immutable");
			expect(setupAction).toContain("corepack enable");
		});
	}, 240_000);

	it("generates bun projects with bun scripts and the bun setup action", async () => {
		await withScenarioWorkspace("multi-pm-bun", async (workspace) => {
			await createProject(workspace, {
				...baseConfig,
				packageManager: "Bun",
			});

			const root = await readJson<PackageJson>(
				join(workspace.projectRoot, "package.json"),
			);
			const web = await readJson<PackageJson>(
				join(workspace.projectRoot, "apps/web/package.json"),
			);
			const ui = await readJson<PackageJson>(
				join(workspace.projectRoot, "packages/ui/package.json"),
			);
			const setupAction = await readFile(
				join(workspace.projectRoot, "tooling/github/setup/action.yml"),
				"utf-8",
			);

			expect(root.workspaces).toEqual(["apps/*", "packages/*", "tooling/*"]);
			expect(root.trustedDependencies).toEqual([
				"esbuild",
				"lefthook",
				"msw",
				"sharp",
			]);
			expect(
				await pathExists(join(workspace.projectRoot, "pnpm-workspace.yaml")),
			).toBe(false);
			expect(await pathExists(join(workspace.projectRoot, ".yarnrc.yml"))).toBe(
				false,
			);
			expect(web.dependencies?.["@acme/ui"]).toBe("workspace:*");
			expect(web.dependencies?.next).toMatch(/^\d/);
			expectResolvedDependencies(
				await readWorkspaceManifests(workspace.projectRoot),
				{ allowWorkspaceProtocol: true },
			);
			expect(web.scripts?.build).toBe("bun run with-env next build");
			expect(web.scripts?.["db:generate"]).toBe(
				"bun --filter @acme/db generate",
			);
			expect(ui.scripts?.["ui-add"]).toBe("bunx shadcn@latest add");
			expect(setupAction).toContain("oven-sh/setup-bun");
			expect(setupAction).toContain("bun install --frozen-lockfile");
		});
	}, 240_000);

	it.each(
		prismaCells,
	)("wires prisma scripts and the db dependency for $pm", async ({
		dbDependency,
		dbGenerate,
		migrate,
		pm,
		postinstall,
		trustedDependencies,
	}) => {
		await withScenarioWorkspace(
			`multi-pm-prisma-${pm.toLowerCase()}`,
			async (workspace) => {
				await createProject(workspace, {
					...baseConfig,
					database: "postgresql",
					orm: "prisma",
					packageManager: pm,
				});

				const root = await readJson<PackageJson>(
					join(workspace.projectRoot, "package.json"),
				);
				const web = await readJson<PackageJson>(
					join(workspace.projectRoot, "apps/web/package.json"),
				);
				const db = await readJson<PackageJson>(
					join(workspace.projectRoot, "packages/db/package.json"),
				);

				expect(root.scripts?.postinstall).toBe(postinstall);
				expect(root.trustedDependencies).toEqual(trustedDependencies);
				expect(db.scripts?.migrate).toBe(migrate);
				expect(web.scripts?.["db:generate"]).toBe(dbGenerate);
				expect(web.dependencies?.["@acme/db"]).toBe(dbDependency);
				expect(
					await pathExists(join(workspace.projectRoot, "pnpm-workspace.yaml")),
				).toBe(false);
			},
		);
	}, 240_000);
});
