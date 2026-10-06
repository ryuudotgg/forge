import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "vitest";
import {
	expectInstallAndTypecheck,
	forgeEnvironment,
	pathExists,
	readJson,
	runCommand,
	type ScenarioProject,
} from "./harness";

export interface LinterSurfaces {
	readonly configFiles: ReadonlyArray<string>;
	readonly devDependencies: ReadonlyArray<string>;
	readonly absentConfigFiles: ReadonlyArray<string>;
	readonly absentDevDependencies: ReadonlyArray<string>;
}

const unformattedProbe = "const  probe = 'forge'\nexport { probe }\n";
const formattedProbe = 'const probe = "forge";\nexport { probe };\n';

async function expectRun(
	workspace: ScenarioProject,
	command: string,
	args: ReadonlyArray<string>,
) {
	const result = await runCommand(command, args, {
		cwd: workspace.projectRoot,
		env: forgeEnvironment(workspace.workspaceRoot),
	});

	expect(
		result.exitCode,
		`${command} ${args.join(" ")} failed\n${result.stdout}\n${result.stderr}`,
	).toBe(0);

	return result;
}

async function expectCleanTree(workspace: ScenarioProject) {
	const status = await expectRun(workspace, "git", ["status", "--porcelain"]);
	expect(status.stdout).toBe("");
}

async function expectLinterSurfaces(
	workspace: ScenarioProject,
	surfaces: LinterSurfaces,
) {
	for (const file of surfaces.configFiles)
		expect(await pathExists(join(workspace.projectRoot, file)), file).toBe(
			true,
		);

	for (const file of surfaces.absentConfigFiles)
		expect(await pathExists(join(workspace.projectRoot, file)), file).toBe(
			false,
		);

	const rootPackage = await readJson<{
		readonly devDependencies?: Readonly<Record<string, string>>;
	}>(join(workspace.projectRoot, "package.json"));

	const workspaceYaml = await readFile(
		join(workspace.projectRoot, "pnpm-workspace.yaml"),
		"utf-8",
	);

	for (const name of surfaces.devDependencies) {
		expect(rootPackage.devDependencies?.[name], name).toMatch(/^catalog:/);
		expect(workspaceYaml).toMatch(new RegExp(`\\n  "?${name}"?: \\S+`));
	}

	for (const name of surfaces.absentDevDependencies) {
		expect(rootPackage.devDependencies?.[name], name).toBeUndefined();
		expect(workspaceYaml).not.toContain(name);
	}
}

async function expectStagedPreCommit(workspace: ScenarioProject) {
	const stagedPath = join(workspace.projectRoot, "staged-probe.ts");
	const unstagedPath = join(workspace.projectRoot, "unstaged-probe.ts");

	await writeFile(stagedPath, unformattedProbe);
	await writeFile(unstagedPath, unformattedProbe);
	await expectRun(workspace, "git", ["add", "staged-probe.ts"]);

	await expectRun(workspace, "pnpm", ["exec", "lefthook", "run", "pre-commit"]);

	expect(await readFile(stagedPath, "utf-8")).toBe(formattedProbe);
	expect(await readFile(unstagedPath, "utf-8")).toBe(unformattedProbe);

	const unstagedFix = await expectRun(workspace, "git", [
		"diff",
		"--name-only",
		"--",
		"staged-probe.ts",
	]);

	expect(unstagedFix.stdout).toBe("");
}

async function commitFixture(workspace: ScenarioProject) {
	await expectRun(workspace, "git", ["add", "."]);
	await expectRun(workspace, "git", [
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
	]);
}

export async function expectFreshLinterCheck(
	workspace: ScenarioProject,
	surfaces: LinterSurfaces,
) {
	await expectLinterSurfaces(workspace, surfaces);
	await expectRun(workspace, "git", ["init", "-q"]);
	await expectInstallAndTypecheck(workspace, "pnpm");
	await commitFixture(workspace);

	await expectRun(workspace, "pnpm", ["check:fix"]);
	await expectCleanTree(workspace);

	await expectStagedPreCommit(workspace);
}
