import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
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

		expect(actual, file).toBe(expected);
	}
}

describe("add", () => {
	it("installs an addon into the only compatible target without prompting", async () => {
		await withScenarioWorkspace("add", async (workspace) => {
			await createProject(workspace, {
				packageManager: "pnpm",
				web: "nextjs",
			});

			await addAddon(workspace.projectRoot, "tailwind");

			const manifest = await readJson<{
				installs: Array<{ definitionId: string }>;
			}>(join(workspace.projectRoot, ".forge/manifest.json"));

			expect(
				manifest.installs.some((entry) => entry.definitionId === "tailwind"),
			).toBe(true);

			expect(
				await pathExists(join(workspace.projectRoot, "packages/ui/forge.json")),
			).toBe(true);

			expect(
				await pathExists(
					join(workspace.projectRoot, "packages/ui/src/styles/globals.css"),
				),
			).toBe(true);
		});
	});

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

			const manifest = await readJson<{
				installs: Array<{
					definitionId: string;
				}>;
			}>(join(workspace.projectRoot, ".forge/manifest.json"));

			expect(result.stdout).toContain("Search for an addon");
			expect(
				manifest.installs.find((entry) => entry.definitionId === "tailwind"),
			).toBeDefined();

			expect(
				await pathExists(
					join(workspace.projectRoot, "packages/ui/src/styles/globals.css"),
				),
			).toBe(true);
		});
	}, 240_000);
});
