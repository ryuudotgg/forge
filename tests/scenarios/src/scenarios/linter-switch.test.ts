import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import {
	createProject,
	pathExists,
	readJson,
	runCommand,
	runForge,
	type ScenarioProject,
	tryRunForge,
	withScenarioWorkspace,
} from "../utils/harness";

async function treeHashes(projectRoot: string) {
	const entries = await readdir(projectRoot, {
		recursive: true,
		withFileTypes: true,
	});

	const hashes: Record<string, string> = {};
	for (const entry of entries) {
		const path = relative(projectRoot, join(entry.parentPath, entry.name));
		if (!entry.isFile() || path.startsWith(".git/")) continue;

		hashes[path] = createHash("sha256")
			.update(await readFile(join(projectRoot, path)))
			.digest("hex");
	}

	return hashes;
}

async function commitFixture(workspace: ScenarioProject) {
	for (const args of [
		["init", "-q"],
		["add", "."],
		[
			"-c",
			"user.name=Forge",
			"-c",
			"user.email=forge@example.com",
			"-c",
			"commit.gpgsign=false",
			"-c",
			"core.hooksPath=/dev/null",
			"commit",
			"-qm",
			"fixture",
		],
	]) {
		const result = await runCommand("git", args, {
			cwd: workspace.projectRoot,
		});

		expect(result.exitCode, result.stderr).toBe(0);
	}
}

function createFixture(workspace: ScenarioProject, linter: string) {
	return createProject(workspace, {
		addons: ["github-ci", "lefthook", "vscode"],
		packageManager: "pnpm",
		web: "nextjs",
		linter,
	});
}

describe("exclusive addon switches", () => {
	it("refuses a project Git does not track without changing any bytes", async () => {
		await withScenarioWorkspace("switch-no-git", async (workspace) => {
			await createFixture(workspace, "biome");
			const before = await treeHashes(workspace.projectRoot);

			const result = await tryRunForge(
				workspace.projectRoot,
				["add", "oxc", "--no-install"],
				{ workspaceRoot: workspace.workspaceRoot },
			);

			expect(result.exitCode).toBe(1);
			expect(result.stdout).toContain("until Git tracks this project");
			expect(await treeHashes(workspace.projectRoot)).toEqual(before);
		});
	});

	it("refuses an untracked file without changing any bytes", async () => {
		await withScenarioWorkspace("switch-dirty", async (workspace) => {
			await createFixture(workspace, "biome");
			await commitFixture(workspace);
			await writeFile(
				join(workspace.projectRoot, "untracked.ts"),
				"export {};\n",
			);

			const before = await treeHashes(workspace.projectRoot);

			const result = await tryRunForge(
				workspace.projectRoot,
				["add", "oxc", "--no-install"],
				{ workspaceRoot: workspace.workspaceRoot },
			);

			expect(result.exitCode).toBe(1);
			expect(result.stdout).toContain("uncommitted changes");
			expect(await treeHashes(workspace.projectRoot)).toEqual(before);
		});
	});

	it.each([
		{
			from: "biome",
			to: "oxc",
			present: [".oxlintrc.json", ".oxfmtrc.json"],
			absent: ["biome.json"],
			dependencies: ["oxlint", "oxfmt"],
			absentDependencies: ["@biomejs/biome"],
			check: "oxlint && oxfmt --check",
			reformat: "pnpm exec oxfmt --no-error-on-unmatched-pattern .",
		},
		{
			from: "oxc",
			to: "biome",
			present: ["biome.json"],
			absent: [".oxlintrc.json", ".oxfmtrc.json"],
			dependencies: ["@biomejs/biome"],
			absentDependencies: ["oxlint", "oxfmt"],
			check: "biome check .",
			reformat:
				"pnpm exec biome check --write --linter-enabled=false --files-ignore-unknown=true --no-errors-on-unmatched .",
		},
	])("switches $from to $to without installing", async (direction) => {
		await withScenarioWorkspace(`switch-${direction.to}`, async (workspace) => {
			await createFixture(workspace, direction.from);
			await commitFixture(workspace);

			const result = await runForge(
				workspace.projectRoot,
				["add", direction.to, "--no-install"],
				{ workspaceRoot: workspace.workspaceRoot },
			);

			const rootPackage = await readJson<{
				readonly devDependencies: Readonly<Record<string, string>>;
				readonly scripts: Readonly<Record<string, string>>;
			}>(join(workspace.projectRoot, "package.json"));

			const manifest = await readJson<{
				readonly config: { readonly linter: string };
				readonly installs: ReadonlyArray<{ readonly definitionId: string }>;
			}>(join(workspace.projectRoot, ".forge/manifest.json"));

			for (const file of direction.present)
				expect(await pathExists(join(workspace.projectRoot, file))).toBe(true);

			for (const file of direction.absent)
				expect(await pathExists(join(workspace.projectRoot, file))).toBe(false);

			for (const dependency of direction.dependencies)
				expect(rootPackage.devDependencies[dependency]).toBeDefined();

			for (const dependency of direction.absentDependencies)
				expect(rootPackage.devDependencies[dependency]).toBeUndefined();

			expect(rootPackage.scripts.check).toBe(direction.check);
			expect(manifest.config.linter).toBe(direction.to);
			expect(manifest.installs.map((entry) => entry.definitionId)).toContain(
				direction.to,
			);

			expect(
				manifest.installs.map((entry) => entry.definitionId),
			).not.toContain(direction.from);

			expect(result.stdout).toContain(
				`Run "pnpm install --no-frozen-lockfile", then "${direction.reformat}", then "forge update --keep-user" inside the project to finish the switch.`,
			);
		});
	});
});
