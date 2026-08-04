import { readdir, readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	addAddon,
	createProject,
	pathExists,
	readJson,
	runForge,
	tryRunForge,
	withScenarioWorkspace,
} from "../utils/harness";

interface ManifestSnapshot {
	readonly config: Record<string, unknown>;
	readonly installs: Array<ManifestInstall>;
	readonly modules: Record<string, { readonly root?: string }>;
}

type ManifestInstallTarget =
	| { readonly kind: "project" }
	| { readonly kind: "module"; readonly moduleId: string };

interface ManifestInstall {
	readonly definitionId: string;
	readonly targets: Array<ManifestInstallTarget>;
}

type NormalizedInstallTarget =
	| { readonly kind: "project" }
	| { readonly kind: "module"; readonly root: string };

interface NormalizedInstall {
	readonly definitionId: string;
	readonly targets: Array<NormalizedInstallTarget>;
}

interface UiModuleConfig {
	readonly capabilities: ReadonlyArray<string>;
}

interface UiPackageJson {
	readonly dependencies?: Record<string, string>;
	readonly devDependencies?: Record<string, string>;
}

interface AppPackageJson {
	readonly dependencies?: Record<string, string>;
	readonly scripts?: Record<string, string>;
}

interface LockfileSnapshot {
	readonly artifacts: Record<
		string,
		{
			readonly base?: {
				readonly hash: string;
				readonly mergeKind: string;
				readonly semanticsVersion: number;
			};
			readonly path: string;
		}
	>;
}

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

function sortInstalls<Install extends { readonly definitionId: string }>(
	installs: ReadonlyArray<Install>,
) {
	return [...installs].sort((a, b) =>
		a.definitionId.localeCompare(b.definitionId),
	);
}

function moduleRoot(manifest: ManifestSnapshot, moduleId: string) {
	const root = manifest.modules[moduleId]?.root;

	if (root === undefined) throw new Error(`Module Root Not Found: ${moduleId}`);

	return root;
}

function normalizeInstalls(
	manifest: ManifestSnapshot,
): Array<NormalizedInstall> {
	return manifest.installs.map((install) => ({
		definitionId: install.definitionId,
		targets: install.targets.map((target) =>
			target.kind === "module"
				? { kind: "module", root: moduleRoot(manifest, target.moduleId) }
				: target,
		),
	}));
}

async function expectMatchingProjects(
	actualRoot: string,
	expectedRoot: string,
) {
	const [actualFiles, expectedFiles] = await Promise.all([
		listProjectFiles(actualRoot),
		listProjectFiles(expectedRoot),
	]);

	expect(actualFiles).toEqual(expectedFiles);

	for (const file of actualFiles) {
		if (file.endsWith("forge.json")) {
			const [actualConfig, expectedConfig] = await Promise.all([
				readJson<Record<string, unknown>>(join(actualRoot, file)),
				readJson<Record<string, unknown>>(join(expectedRoot, file)),
			]);

			delete actualConfig.id;
			delete expectedConfig.id;

			expect(actualConfig, file).toEqual(expectedConfig);
			continue;
		}

		const [actual, expected] = await Promise.all([
			readFile(join(actualRoot, file), "utf-8"),
			readFile(join(expectedRoot, file), "utf-8"),
		]);

		if (basename(file) === ".env") continue;

		expect(actual, file).toBe(expected);
	}

	const [actualManifest, expectedManifest] = await Promise.all([
		readJson<ManifestSnapshot>(join(actualRoot, ".forge/manifest.json")),
		readJson<ManifestSnapshot>(join(expectedRoot, ".forge/manifest.json")),
	]);

	expect(sortInstalls(normalizeInstalls(actualManifest))).toEqual(
		sortInstalls(normalizeInstalls(expectedManifest)),
	);

	const actualConfig = { ...actualManifest.config };
	const expectedConfig = { ...expectedManifest.config };

	delete actualConfig.path;
	delete expectedConfig.path;

	expect(actualConfig).toEqual(expectedConfig);

	const [actualLockfile, expectedLockfile] = await Promise.all([
		readJson<{ artifacts: Record<string, { path: string }> }>(
			join(actualRoot, ".forge/lock.json"),
		),
		readJson<{ artifacts: Record<string, { path: string }> }>(
			join(expectedRoot, ".forge/lock.json"),
		),
	]);

	const artifactPaths = (lockfile: {
		artifacts: Record<string, { path: string }>;
	}) =>
		Object.values(lockfile.artifacts)
			.map((artifact) => artifact.path)
			.sort();

	expect(artifactPaths(actualLockfile)).toEqual(
		artifactPaths(expectedLockfile),
	);
}

describe("add", () => {
	it("preserves edited mergeable surfaces while adding adapter contributions", async () => {
		await withScenarioWorkspace("add-edited-surfaces", async (workspace) => {
			await createProject(workspace, {
				database: "postgresql",
				orm: "drizzle",
				packageManager: "pnpm",
				web: "nextjs",
			});
			const lockfile = await readJson<LockfileSnapshot>(
				join(workspace.projectRoot, ".forge/lock.json"),
			);
			const envArtifact = Object.values(lockfile.artifacts).find(
				(artifact) => artifact.path === ".env",
			);
			const envExampleArtifact = Object.values(lockfile.artifacts).find(
				(artifact) => artifact.path === ".env.example",
			);
			expect(envArtifact?.base).toBeUndefined();
			expect(envExampleArtifact?.base).toMatchObject({ mergeKind: "env" });

			const packagePath = join(workspace.projectRoot, "apps/web/package.json");
			const packageJson = await readJson<AppPackageJson>(packagePath);
			const dev = packageJson.scripts?.dev;
			if (dev === undefined) throw new Error("Missing Dev Script");
			await writeFile(
				packagePath,
				`${JSON.stringify(
					{
						...packageJson,
						scripts: { ...packageJson.scripts, dev: `${dev} --user-edit` },
					},
					null,
					2,
				)}\n`,
			);

			const gitignorePath = join(workspace.projectRoot, ".gitignore");
			const gitignore = await readFile(gitignorePath, "utf-8");
			await writeFile(gitignorePath, `${gitignore}user-cache/\n`);

			const envExamplePath = join(workspace.projectRoot, ".env.example");
			const envExample = await readFile(envExamplePath, "utf-8");
			await writeFile(
				envExamplePath,
				envExample.replace(/^DATABASE_URL=.*$/m, "DATABASE_URL=user-value"),
			);

			await addAddon(workspace.projectRoot, "better-auth");

			const mergedPackage = await readJson<AppPackageJson>(packagePath);
			expect(mergedPackage.scripts?.dev).toBe(`${dev} --user-edit`);
			expect(mergedPackage.dependencies).toHaveProperty("better-auth");
			expect(mergedPackage.dependencies).toHaveProperty("@acme/auth");
			expect(await readFile(gitignorePath, "utf-8")).toContain("user-cache/");
			const mergedEnvExample = await readFile(envExamplePath, "utf-8");
			expect(mergedEnvExample).toContain("DATABASE_URL=user-value");
			expect(mergedEnvExample).toContain("AUTH_SECRET=");
		});
	}, 240_000);

	it("refuses same-key divergence before mutating the project", async () => {
		await withScenarioWorkspace("add-merge-conflict", async (workspace) => {
			await createProject(workspace, {
				packageManager: "pnpm",
				web: "nextjs",
			});
			const packagePath = join(workspace.projectRoot, "apps/web/package.json");
			const packageJson = await readJson<AppPackageJson>(packagePath);
			const userPackage = `${JSON.stringify(
				{
					...packageJson,
					scripts: {
						...packageJson.scripts,
						"db:generate": "user command",
					},
				},
				null,
				2,
			)}\n`;
			await writeFile(packagePath, userPackage);
			const manifestPath = join(workspace.projectRoot, ".forge/manifest.json");
			const lockfilePath = join(workspace.projectRoot, ".forge/lock.json");
			const [manifestBefore, lockfileBefore] = await Promise.all([
				readFile(manifestPath, "utf-8"),
				readFile(lockfilePath, "utf-8"),
			]);

			const result = await tryRunForge(
				workspace.projectRoot,
				["add", "prisma"],
				{
					workspaceRoot: workspace.workspaceRoot,
				},
			);
			const output = result.stdout + result.stderr;
			expect(result.exitCode).toBe(1);
			expect(output).toContain("Semantic merge conflicts were found:");
			expect(output).toContain(
				'apps/web/package.json -> scripts["db:generate"]:',
			);
			expect(output).toContain('base was missing, user has "user command"');
			expect(output).toContain("Resolve each conflict, then run Forge again.");
			expect(await readFile(packagePath, "utf-8")).toBe(userPackage);
			expect(await readFile(manifestPath, "utf-8")).toBe(manifestBefore);
			expect(await readFile(lockfilePath, "utf-8")).toBe(lockfileBefore);
			expect(await pathExists(join(workspace.projectRoot, "packages/db"))).toBe(
				false,
			);

			await runForge(
				workspace.projectRoot,
				["add", "prisma", "--accept-forge"],
				{ workspaceRoot: workspace.workspaceRoot },
			);
			const resolvedPackage = await readJson<AppPackageJson>(packagePath);
			expect(resolvedPackage.scripts?.["db:generate"]).toBe(
				"pnpm --filter @acme/db run generate",
			);
			expect(await pathExists(join(workspace.projectRoot, "packages/db"))).toBe(
				true,
			);
		});
	}, 240_000);

	it("installs tailwind as a project record without prompting", async () => {
		await withScenarioWorkspace("add", async (workspace) => {
			await createProject(workspace, {
				packageManager: "pnpm",
				web: "nextjs",
			});

			const uiConfigPath = join(
				workspace.projectRoot,
				"packages/ui/forge.json",
			);
			const uiPackageJsonPath = join(
				workspace.projectRoot,
				"packages/ui/package.json",
			);

			const uiConfigBefore = await readJson<UiModuleConfig>(uiConfigPath);
			const uiPackageBefore = await readJson<UiPackageJson>(uiPackageJsonPath);

			expect(uiConfigBefore.capabilities).toContain("css");
			expect(uiConfigBefore.capabilities).not.toContain("tailwind");
			expect(uiPackageBefore.devDependencies?.tailwindcss).toBeUndefined();

			await addAddon(workspace.projectRoot, "tailwind");

			const manifest = await readJson<ManifestSnapshot>(
				join(workspace.projectRoot, ".forge/manifest.json"),
			);

			expect(manifest.installs).toContainEqual({
				definitionId: "tailwind",
				targets: [{ kind: "project" }],
			});

			const uiConfigAfter = await readJson<UiModuleConfig>(uiConfigPath);
			const uiPackageAfter = await readJson<UiPackageJson>(uiPackageJsonPath);

			expect([...uiConfigAfter.capabilities].sort()).toEqual([
				"react",
				"tailwind",
				"ui",
			]);
			expect(uiPackageAfter.devDependencies?.tailwindcss).toBe("catalog:");
			expect(uiPackageAfter.devDependencies?.["@tailwindcss/postcss"]).toBe(
				"catalog:",
			);
			expect(uiPackageAfter.devDependencies?.shadcn).toBe("catalog:");
			expect(uiPackageAfter.dependencies?.["tw-animate-css"]).toBe("catalog:");
		});
	}, 120_000);

	it("reconciles the whole workspace when adding prisma to a project without an orm", async () => {
		await withScenarioWorkspace("add-prisma", async (workspace) => {
			await createProject(workspace, {
				packageManager: "pnpm",
				web: "nextjs",
			});

			await addAddon(workspace.projectRoot, "prisma");

			const readText = (path: string) =>
				readFile(join(workspace.projectRoot, path), "utf-8");

			const [workspaceYaml, nextConfig, manifest] = await Promise.all([
				readText("pnpm-workspace.yaml"),
				readText("apps/web/next.config.ts"),
				readJson<{ config: { orm?: string } }>(
					join(workspace.projectRoot, ".forge/manifest.json"),
				),
			]);

			expect(workspaceYaml).toContain('"@prisma/engines": true');
			expect(workspaceYaml).toContain("prisma: true");
			expect(nextConfig).toContain('"@acme/db"');
			expect(manifest.config.orm).toBe("prisma");

			expect(
				await pathExists(
					join(workspace.projectRoot, "packages/db/prisma.config.ts"),
				),
			).toBe(true);

			await createProject(workspace, {
				orm: "prisma",
				packageManager: "pnpm",
				path: "./expected",
				web: "nextjs",
			});

			await expectMatchingProjects(
				workspace.projectRoot,
				join(workspace.workspaceRoot, "expected"),
			);
		});
	}, 240_000);

	it("renders the prisma adapter when adding better-auth to a prisma project", async () => {
		await withScenarioWorkspace("add-better-auth", async (workspace) => {
			await createProject(workspace, {
				orm: "prisma",
				packageManager: "pnpm",
				web: "nextjs",
			});

			await addAddon(workspace.projectRoot, "better-auth");

			const readText = (path: string) =>
				readFile(join(workspace.projectRoot, path), "utf-8");

			const [auth, schema, manifest] = await Promise.all([
				readText("packages/auth/src/index.ts"),
				readText("packages/db/prisma/schema.prisma"),
				readJson<{ config: { authentication?: string } }>(
					join(workspace.projectRoot, ".forge/manifest.json"),
				),
			]);

			expect(auth).toContain(
				'import { prismaAdapter } from "better-auth/adapters/prisma";',
			);
			expect(schema).toContain("model Session {");
			expect(manifest.config.authentication).toBe("better-auth");

			await createProject(workspace, {
				authentication: "better-auth",
				orm: "prisma",
				packageManager: "pnpm",
				path: "./expected",
				web: "nextjs",
			});

			await expectMatchingProjects(
				workspace.projectRoot,
				join(workspace.workspaceRoot, "expected"),
			);
		});
	}, 240_000);

	it("refuses to add a second orm instead of swapping", async () => {
		await withScenarioWorkspace("add-orm-conflict", async (workspace) => {
			await createProject(workspace, {
				orm: "drizzle",
				packageManager: "pnpm",
				web: "nextjs",
			});

			const result = await tryRunForge(
				workspace.projectRoot,
				["add", "prisma"],
				{ workspaceRoot: workspace.workspaceRoot },
			);

			expect(result.exitCode).toBe(1);
			expect(result.stdout + result.stderr).toContain(
				"This project already uses Drizzle.",
			);

			expect(
				await pathExists(
					join(workspace.projectRoot, "packages/db/drizzle.config.ts"),
				),
			).toBe(true);
			expect(
				await pathExists(
					join(workspace.projectRoot, "packages/db/prisma.config.ts"),
				),
			).toBe(false);

			const manifest = await readJson<ManifestSnapshot>(
				join(workspace.projectRoot, ".forge/manifest.json"),
			);

			expect(manifest.config.orm).toBe("drizzle");
			expect(
				manifest.installs.some((entry) => entry.definitionId === "prisma"),
			).toBe(false);
		});
	}, 240_000);

	it("prompts for an addon when no id is provided", async () => {
		await withScenarioWorkspace("add-prompt", async (workspace) => {
			await createProject(workspace, {
				packageManager: "pnpm",
				web: "nextjs",
			});

			const result = await runForge(workspace.projectRoot, ["add"], {
				input: "tailwind\r",
				workspaceRoot: workspace.workspaceRoot,
			});

			const manifest = await readJson<ManifestSnapshot>(
				join(workspace.projectRoot, ".forge/manifest.json"),
			);

			expect(result.stdout).toContain("Search for an addon");
			expect(result.stdout).not.toContain("Which addon do you want to add?");
			expect(manifest.installs).toContainEqual({
				definitionId: "tailwind",
				targets: [{ kind: "project" }],
			});

			const uiConfig = await readJson<UiModuleConfig>(
				join(workspace.projectRoot, "packages/ui/forge.json"),
			);
			const uiPackageJson = await readJson<UiPackageJson>(
				join(workspace.projectRoot, "packages/ui/package.json"),
			);

			expect([...uiConfig.capabilities].sort()).toEqual([
				"react",
				"tailwind",
				"ui",
			]);
			expect(uiPackageJson.devDependencies?.tailwindcss).toBe("catalog:");
		});
	}, 240_000);
});
