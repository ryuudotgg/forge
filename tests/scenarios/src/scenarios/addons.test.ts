import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	addAddon,
	createProject,
	pathExists,
	readJson,
	updateProject,
	withScenarioWorkspace,
} from "../utils/harness";

const optInFiles = [
	".github/workflows/ci.yml",
	".vscode/extensions.json",
	".vscode/settings.json",
	"commitlint.config.ts",
	"lefthook.yml",
	"packages/shared/forge.json",
	"tooling/github/package.json",
	"tooling/github/setup/action.yml",
];

const lefthookPreCommitYaml = `pre-commit:
  jobs:
    - run: pnpm check:fix --staged --no-errors-on-unmatched
    - run: git update-index --again
`;

const lefthookFullYaml = `commit-msg:
  jobs:
    - run: pnpm exec commitlint --edit {1}

${lefthookPreCommitYaml}`;

interface PackageJson {
	readonly dependencies?: Record<string, string>;
	readonly devDependencies?: Record<string, string>;
	readonly name?: string;
	readonly scripts?: Record<string, string>;
}

interface AddonsManifest {
	readonly config: { readonly addons?: ReadonlyArray<string> };
	readonly installs: Array<{
		definitionId: string;
		targets: Array<{ kind: string }>;
	}>;
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
			expect(root.devDependencies?.lefthook).toBe("catalog:");
			expect(root.devDependencies?.["@commitlint/cli"]).toBe("catalog:");

			const lefthook = await readFile(
				join(workspace.projectRoot, "lefthook.yml"),
				"utf-8",
			);

			expect(lefthook).toBe(lefthookFullYaml);

			const ci = await readFile(
				join(workspace.projectRoot, ".github/workflows/ci.yml"),
				"utf-8",
			);

			expect(ci).toContain("run: pnpm check");
			expect(ci).toContain("run: pnpm check:ws");
			expect(ci).toContain("run: pnpm typecheck");
			expect(ci).toContain("uses: ./tooling/github/setup");

			const vscodeSettings = await readJson<Record<string, unknown>>(
				join(workspace.projectRoot, ".vscode/settings.json"),
			);

			expect(vscodeSettings["editor.defaultFormatter"]).toBe("biomejs.biome");

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
			expect(root.devDependencies?.lefthook).toBeUndefined();
			expect(root.devDependencies?.["@commitlint/cli"]).toBeUndefined();

			await addAddon(workspace.projectRoot, "lefthook");

			const lefthookOnly = await readFile(
				join(workspace.projectRoot, "lefthook.yml"),
				"utf-8",
			);

			expect(lefthookOnly).toBe(lefthookPreCommitYaml);
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

			expect(lefthookWithCommitlint).toBe(lefthookFullYaml);
			expect(
				await pathExists(join(workspace.projectRoot, "commitlint.config.ts")),
			).toBe(true);

			await addAddon(workspace.projectRoot, "shared");

			expect(
				await pathExists(
					join(workspace.projectRoot, "packages/shared/forge.json"),
				),
			).toBe(true);
			expect(
				await pathExists(
					join(workspace.projectRoot, "packages/shared/src/index.ts"),
				),
			).toBe(true);

			const sharedPackageJson = await readJson<PackageJson>(
				join(workspace.projectRoot, "packages/shared/package.json"),
			);

			expect(sharedPackageJson.name).toBe("@acme/shared");

			const manifest = await readJson<AddonsManifest>(
				join(workspace.projectRoot, ".forge/manifest.json"),
			);

			expect(manifest.config.addons).toEqual([
				"lefthook",
				"commitlint",
				"shared",
			]);
			expect(manifest.installs).toContainEqual({
				definitionId: "lefthook",
				targets: [{ kind: "project" }],
			});
			expect(manifest.installs).toContainEqual({
				definitionId: "commitlint",
				targets: [{ kind: "project" }],
			});
			expect(manifest.installs).toContainEqual({
				definitionId: "shared",
				targets: [{ kind: "project" }],
			});

			await updateProject(workspace.projectRoot);

			const lefthookAfterUpdate = await readFile(
				join(workspace.projectRoot, "lefthook.yml"),
				"utf-8",
			);

			expect(lefthookAfterUpdate).toBe(lefthookFullYaml);
		});
	}, 240_000);
});
