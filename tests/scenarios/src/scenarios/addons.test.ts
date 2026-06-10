import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	addAddon,
	createProject,
	pathExists,
	readJson,
	withScenarioWorkspace,
} from "../utils/harness";

const optInFiles = [
	".github/workflows/ci.yml",
	".vscode/settings.json",
	"commitlint.config.ts",
	"lefthook.yml",
	"packages/shared/forge.json",
	"tooling/github/setup/action.yml",
];

interface PackageJson {
	readonly dependencies?: Record<string, string>;
	readonly name?: string;
	readonly scripts?: Record<string, string>;
}

describe("addons", () => {
	it("generates opt-in tooling and the shared package when selected", async () => {
		await withScenarioWorkspace("addons-full", async (workspace) => {
			await createProject(workspace, {
				addons: ["commitlint", "github-ci", "lefthook", "shared", "vscode"],
				linter: "biome",
				packageManager: "pnpm",
				web: "nextjs",
			});

			for (const file of optInFiles)
				expect(await pathExists(join(workspace.projectRoot, file)), file).toBe(
					true,
				);

			const manifest = await readJson<{
				installs: Array<{ definitionId: string }>;
			}>(join(workspace.projectRoot, ".forge/manifest.json"));

			expect(manifest.installs.map((entry) => entry.definitionId)).toEqual(
				expect.arrayContaining([
					"commitlint",
					"github-ci",
					"lefthook",
					"shared",
					"vscode",
				]),
			);

			const root = await readJson<PackageJson>(
				join(workspace.projectRoot, "package.json"),
			);
			const shared = await readJson<PackageJson>(
				join(workspace.projectRoot, "packages/shared/package.json"),
			);

			expect(root.scripts?.prepare).toBe("lefthook install");

			const lefthook = await readFile(
				join(workspace.projectRoot, "lefthook.yml"),
				"utf-8",
			);

			expect(lefthook).toContain("pre-commit:");
			expect(lefthook).toContain("commit-msg:");
			expect(lefthook).toContain("commitlint --edit {1}");

			expect(shared.name).toBe("@acme/shared");
			expect(shared.dependencies?.nanoid).toBe("catalog:");
			expect(
				await pathExists(
					join(workspace.projectRoot, "packages/shared/src/index.ts"),
				),
			).toBe(true);
		});
	}, 240_000);

	it("keeps the core lean without addons and installs them later via add", async () => {
		await withScenarioWorkspace("addons-lean", async (workspace) => {
			await createProject(workspace, {
				linter: "biome",
				packageManager: "pnpm",
				web: "nextjs",
			});

			for (const file of optInFiles)
				expect(await pathExists(join(workspace.projectRoot, file)), file).toBe(
					false,
				);

			const root = await readJson<PackageJson>(
				join(workspace.projectRoot, "package.json"),
			);

			expect(root.scripts?.prepare).toBeUndefined();

			await addAddon(workspace.projectRoot, "lefthook");

			const lefthookOnly = await readFile(
				join(workspace.projectRoot, "lefthook.yml"),
				"utf-8",
			);

			expect(lefthookOnly).toContain("pre-commit:");
			expect(lefthookOnly).not.toContain("commit-msg:");
			expect(
				await pathExists(join(workspace.projectRoot, "commitlint.config.ts")),
			).toBe(false);

			const rootWithHooks = await readJson<PackageJson>(
				join(workspace.projectRoot, "package.json"),
			);

			expect(rootWithHooks.scripts?.prepare).toBe("lefthook install");

			await addAddon(workspace.projectRoot, "commitlint");

			const lefthookWithCommitlint = await readFile(
				join(workspace.projectRoot, "lefthook.yml"),
				"utf-8",
			);

			expect(lefthookWithCommitlint).toContain("commit-msg:");
			expect(lefthookWithCommitlint).toContain("commitlint --edit {1}");
			expect(
				await pathExists(join(workspace.projectRoot, "commitlint.config.ts")),
			).toBe(true);

			await addAddon(workspace.projectRoot, "shared");

			expect(
				await pathExists(
					join(workspace.projectRoot, "packages/shared/src/index.ts"),
				),
			).toBe(true);
		});
	}, 240_000);
});
