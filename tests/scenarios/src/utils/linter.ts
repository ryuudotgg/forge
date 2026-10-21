import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "vitest";
import {
	commitFixture,
	expectCleanTree,
	expectInstallAndTypecheck,
	expectRun,
	pathExists,
	readJson,
	runForge,
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

export async function expectLinterSwitch(
	workspace: ScenarioProject,
	options: { readonly to: string; readonly surfaces: LinterSurfaces },
) {
	const probePath = join(workspace.projectRoot, "apps/web/app/switch-probe.ts");
	const probe =
		"import {join} from 'node:path'\nimport {readFile} from 'node:fs/promises'\n\nexport function readProbe(root:string){return readFile(join(root,'probe.txt'),'utf-8')}\n";

	const expected =
		'import { readFile } from "node:fs/promises";\nimport { join } from "node:path";\n\nexport function readProbe(root: string) {\n  return readFile(join(root, "probe.txt"), "utf-8");\n}\n';

	await expectRun(workspace, "git", ["init", "-q"]);
	await expectInstallAndTypecheck(workspace, "pnpm");
	await writeFile(probePath, probe);
	await commitFixture(workspace);

	await runForge(workspace.projectRoot, ["add", options.to], {
		workspaceRoot: workspace.workspaceRoot,
	});

	await expectLinterSurfaces(workspace, options.surfaces);

	const manifest = await readJson<{
		readonly config: { readonly linter: string };
	}>(join(workspace.projectRoot, ".forge/manifest.json"));

	expect(manifest.config.linter).toBe(options.to);
	await expectRun(workspace, "pnpm", ["check"]);
	expect(await readFile(probePath, "utf-8")).toBe(expected);

	await commitFixture(workspace);

	await expectRun(workspace, "pnpm", ["check:fix"]);
	await expectCleanTree(workspace);

	await runForge(workspace.projectRoot, ["update", "--keep-user"], {
		workspaceRoot: workspace.workspaceRoot,
	});

	await expectCleanTree(workspace);
}
