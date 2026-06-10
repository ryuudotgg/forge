import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	createProject,
	pathExists,
	readJson,
	withScenarioWorkspace,
} from "../utils/harness";

const baseConfig = {
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
	readonly workspaces?: ReadonlyArray<string>;
}

function dependencyValues(pkg: PackageJson): ReadonlyArray<string> {
	return [
		...Object.values(pkg.dependencies ?? {}),
		...Object.values(pkg.devDependencies ?? {}),
	];
}

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
			expect(workspaceYaml).toContain("catalog:");
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

			for (const pkg of [root, web, db])
				for (const value of dependencyValues(pkg)) {
					expect(value).not.toMatch(/^catalog:/);
					expect(value).not.toMatch(/^workspace:/);
				}

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
			expect(yarnrc).toBe("nodeLinker: node-modules\n");
			expect(gitignore).toContain(".yarn/*");
			expect(web.dependencies?.["@acme/ui"]).toBe("workspace:*");
			expect(web.dependencies?.next).not.toMatch(/^catalog:/);
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
			expect(web.dependencies?.["@acme/ui"]).toBe("workspace:*");
			expect(web.dependencies?.next).not.toMatch(/^catalog:/);
			expect(web.scripts?.build).toBe("bun run with-env next build");
			expect(web.scripts?.["db:generate"]).toBe(
				"bun --filter @acme/db generate",
			);
			expect(ui.scripts?.["ui-add"]).toBe("bunx shadcn@latest add");
			expect(setupAction).toContain("oven-sh/setup-bun");
			expect(setupAction).toContain("bun install --frozen-lockfile");
		});
	}, 240_000);
});
