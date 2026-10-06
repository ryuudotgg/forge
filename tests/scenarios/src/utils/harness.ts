import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
	access,
	mkdir,
	mkdtemp,
	readFile,
	rename,
	rm,
	writeFile,
} from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { stripVTControlCharacters } from "node:util";
import { expect, inject } from "vitest";

const turboCacheSummaryPattern = /^\s*Cached:\s+(\d+ cached, \d+ total)/m;

export const repoRoot = resolve(process.cwd(), "..", "..");

export const forgeCliPath = join(
	repoRoot,
	"packages",
	"cli",
	"dist",
	"index.mjs",
);

export interface ForgeCommandResult {
	readonly exitCode: number;
	readonly stderr: string;
	readonly stdout: string;
}

export interface ScenarioProject {
	readonly projectRoot: string;
	readonly workspaceRoot: string;
}

function reportTurboCache(
	workspace: ScenarioProject,
	script: "build" | "typecheck",
	result: ForgeCommandResult,
) {
	const stdout = stripVTControlCharacters(result.stdout);
	const summary =
		stdout.match(turboCacheSummaryPattern)?.[1] ?? "no cache summary";

	const project =
		expect.getState().currentTestName ?? basename(workspace.workspaceRoot);

	console.log(`turbo ${script}: ${summary} (${project})`);
}

export function forgeEnvironment(workspaceRoot: string): NodeJS.ProcessEnv {
	return {
		COREPACK_HOME:
			process.env.COREPACK_HOME ??
			join(homedir(), ".cache", "node", "corepack"),
		FORGE_CACHE_DIR: join(workspaceRoot, ".cache", "forge"),
		XDG_CACHE_HOME: inject("xdgCacheHome"),
		pnpm_config_prefer_offline: "true",
		// Yarn defaults to immutable installs when CI is set, but scenario
		// installs create the lockfile for freshly scaffolded projects.
		YARN_ENABLE_IMMUTABLE_INSTALLS: "0",
	};
}

export async function withScenarioWorkspace<T>(
	name: string,
	run: (workspace: ScenarioProject) => Promise<T>,
) {
	const workspaceRoot = await mkdtemp(
		join(tmpdir(), `forge-scenarios-${name}-`),
	);

	const projectRoot = join(workspaceRoot, "project");
	try {
		await mkdir(projectRoot, { recursive: true });
		return await run({ projectRoot, workspaceRoot });
	} finally {
		await rm(workspaceRoot, { force: true, recursive: true });
	}
}

export async function writeJson(path: string, value: unknown) {
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, `${JSON.stringify(value, null, "\t")}\n`, "utf-8");
}

export async function readJson<T>(path: string): Promise<T> {
	return JSON.parse(await readFile(path, "utf-8")) as T;
}

export async function pathExists(path: string) {
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
}

export async function runCommand(
	command: string,
	args: ReadonlyArray<string>,
	options: {
		readonly cwd: string;
		readonly env?: NodeJS.ProcessEnv;
		readonly input?: string;
	},
): Promise<ForgeCommandResult> {
	return await new Promise((resolvePromise, rejectPromise) => {
		const child = spawn(command, args, {
			cwd: options.cwd,
			env: { ...process.env, ...options.env },
		});

		let stdout = "";
		let stderr = "";

		child.stdout.on("data", (chunk: Buffer | string) => {
			stdout += chunk.toString();
		});

		child.stderr.on("data", (chunk: Buffer | string) => {
			stderr += chunk.toString();
		});

		child.on("error", (error) => {
			rejectPromise(error);
		});

		child.on("close", (code) => {
			resolvePromise({
				exitCode: code ?? 1,
				stderr,
				stdout,
			});
		});

		if (options.input) child.stdin.write(options.input);
		child.stdin.end();
	});
}

export async function tryRunForge(
	cwd: string,
	args: ReadonlyArray<string>,
	options?: {
		readonly cliPath?: string;
		readonly env?: NodeJS.ProcessEnv;
		readonly input?: string;
		readonly workspaceRoot?: string;
	},
) {
	return await runCommand("node", [options?.cliPath ?? forgeCliPath, ...args], {
		cwd,
		env: {
			CI: "true",
			FORCE_COLOR: "0",
			...(options?.workspaceRoot
				? forgeEnvironment(options.workspaceRoot)
				: {}),
			...options?.env,
		},
		input: options?.input,
	});
}

export async function runForge(
	cwd: string,
	args: ReadonlyArray<string>,
	options?: {
		readonly cliPath?: string;
		readonly env?: NodeJS.ProcessEnv;
		readonly input?: string;
		readonly workspaceRoot?: string;
	},
) {
	const result = await tryRunForge(cwd, args, options);
	if (result.exitCode !== 0)
		throw new Error(
			`forge ${args.join(" ")} failed with code ${result.exitCode}\n${result.stdout}\n${result.stderr}`,
		);

	return result;
}

export async function createProject(
	workspace: ScenarioProject,
	config: Record<string, unknown>,
	options?: {
		readonly cliPath?: string;
		readonly env?: NodeJS.ProcessEnv;
		readonly install?: boolean;
	},
) {
	const configPath = join(workspace.workspaceRoot, "forge.config.json");

	const createConfig = {
		name: "acme",
		path: "./project",
		platforms: ["web"],
		runtime: "Node.js",
		slug: "acme",
		...config,
	};

	await writeJson(configPath, createConfig);

	await runForge(
		workspace.workspaceRoot,
		[
			"create",
			"--config",
			configPath,
			...(options?.install ? [] : ["--no-install"]),
			"--no-git",
		],
		{
			cliPath: options?.cliPath,
			env: options?.env,
			workspaceRoot: workspace.workspaceRoot,
		},
	);

	const recordDirectory = process.env.FORGE_RECORD_CONFIGS;
	if (recordDirectory)
		await writeJson(
			join(
				recordDirectory,
				`${basename(workspace.workspaceRoot)}-${randomUUID()}.json`,
			),
			createConfig,
		);
}

export async function addAddon(
	projectRoot: string,
	addonId: string,
	options?: {
		readonly cliPath?: string;
		readonly env?: NodeJS.ProcessEnv;
	},
) {
	await runForge(projectRoot, ["add", addonId], {
		cliPath: options?.cliPath,
		env: options?.env,
		workspaceRoot: dirname(projectRoot),
	});
}

export async function removeAddon(
	projectRoot: string,
	addonId: string,
	options?: {
		readonly cliPath?: string;
		readonly env?: NodeJS.ProcessEnv;
	},
) {
	await runForge(projectRoot, ["remove", addonId], {
		cliPath: options?.cliPath,
		env: options?.env,
		workspaceRoot: dirname(projectRoot),
	});
}

export async function updateProject(
	projectRoot: string,
	options?: {
		readonly cliPath?: string;
		readonly env?: NodeJS.ProcessEnv;
	},
) {
	await runForge(projectRoot, ["update"], {
		cliPath: options?.cliPath,
		env: options?.env,
		workspaceRoot: dirname(projectRoot),
	});
}

export async function expectRun(
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

export async function expectCleanTree(workspace: ScenarioProject) {
	const status = await expectRun(workspace, "git", ["status", "--porcelain"]);
	expect(status.stdout).toBe("");
}

export async function commitFixture(workspace: ScenarioProject) {
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

const installArgsFor: Record<
	"pnpm" | "npm" | "yarn" | "bun",
	ReadonlyArray<string>
> = {
	bun: ["install"],
	npm: ["install"],
	pnpm: ["install"],
	yarn: ["install"],
};

const typecheckArgsFor: Record<
	"pnpm" | "npm" | "yarn" | "bun",
	ReadonlyArray<string>
> = {
	bun: ["run", "typecheck"],
	npm: ["run", "typecheck"],
	pnpm: ["typecheck"],
	yarn: ["typecheck"],
};

const buildArgsFor: Record<
	"pnpm" | "npm" | "yarn" | "bun",
	ReadonlyArray<string>
> = {
	bun: ["run", "build"],
	npm: ["run", "build"],
	pnpm: ["build"],
	yarn: ["build"],
};

const lintDiagnosticPattern = /Found [1-9]\d* (?:warning|info)/;

export function lintScriptsFor(
	manifest: { readonly config?: { readonly linter?: string } },
	scripts: Readonly<Record<string, string>> | undefined,
): ReadonlyArray<string> {
	const linter = manifest.config?.linter;
	if (linter !== undefined && scripts?.check === undefined)
		throw new Error(`Missing Check Script: ${linter}`);

	return ["check", "check:ws"].filter((script) => scripts?.[script]);
}

export function lintScriptFailure(
	script: string,
	result: ForgeCommandResult,
): string | undefined {
	if (result.exitCode !== 0)
		return `${script} failed with code ${result.exitCode}`;

	const output = stripVTControlCharacters(`${result.stdout}\n${result.stderr}`);
	if (lintDiagnosticPattern.test(output))
		return `${script} reported warnings or infos`;

	return undefined;
}

async function expectLintScriptsPass(
	workspace: ScenarioProject,
	pm: "pnpm" | "npm" | "yarn" | "bun",
) {
	const manifest = await readJson<{
		readonly config?: { readonly linter?: string };
	}>(join(workspace.projectRoot, ".forge", "manifest.json"));

	const { scripts } = await readJson<{
		readonly scripts?: Readonly<Record<string, string>>;
	}>(join(workspace.projectRoot, "package.json"));

	for (const script of lintScriptsFor(manifest, scripts)) {
		const result = await runCommand(pm, ["run", script], {
			cwd: workspace.projectRoot,
			env: forgeEnvironment(workspace.workspaceRoot),
		});

		expect(
			lintScriptFailure(script, result),
			`${pm} run ${script}\n${result.stdout}\n${result.stderr}`,
		).toBeUndefined();
	}
}

export async function expectInstallAndTypecheck(
	workspace: ScenarioProject,
	pm: "pnpm" | "npm" | "yarn" | "bun",
) {
	const installResult = await runCommand(pm, installArgsFor[pm], {
		cwd: workspace.projectRoot,
		env: forgeEnvironment(workspace.workspaceRoot),
	});

	expect(
		installResult.exitCode,
		`${pm} install failed with code ${installResult.exitCode}\n${installResult.stdout}\n${installResult.stderr}`,
	).toBe(0);

	await expectLintScriptsPass(workspace, pm);

	const result = await runCommand(pm, typecheckArgsFor[pm], {
		cwd: workspace.projectRoot,
		env: forgeEnvironment(workspace.workspaceRoot),
	});

	reportTurboCache(workspace, "typecheck", result);

	expect(
		result.exitCode,
		`${pm} typecheck failed with code ${result.exitCode}\n${result.stdout}\n${result.stderr}`,
	).toBe(0);
}

export async function expectInstallAndBuild(
	workspace: ScenarioProject,
	pm: "pnpm" | "npm" | "yarn" | "bun",
	installEnv?: NodeJS.ProcessEnv,
) {
	const installResult = await runCommand(pm, installArgsFor[pm], {
		cwd: workspace.projectRoot,
		env: { ...forgeEnvironment(workspace.workspaceRoot), ...installEnv },
	});

	expect(
		installResult.exitCode,
		`${pm} install failed with code ${installResult.exitCode}\n${installResult.stdout}\n${installResult.stderr}`,
	).toBe(0);

	await expectLintScriptsPass(workspace, pm);

	const buildResult = await runCommand(pm, buildArgsFor[pm], {
		cwd: workspace.projectRoot,
		env: forgeEnvironment(workspace.workspaceRoot),
	});

	reportTurboCache(workspace, "build", buildResult);

	expect(
		buildResult.exitCode,
		`${pm} build failed with code ${buildResult.exitCode}\n${buildResult.stdout}\n${buildResult.stderr}`,
	).toBe(0);

	return installResult;
}

export async function expectProductionInstall(workspace: ScenarioProject) {
	const result = await runCommand(
		"pnpm",
		[
			"install",
			"--prod",
			"--frozen-lockfile",
			"--config.confirm-modules-purge=false",
		],
		{
			cwd: workspace.projectRoot,
			env: forgeEnvironment(workspace.workspaceRoot),
		},
	);

	expect(
		result.exitCode,
		`Production Install Failed: code ${result.exitCode}\n${result.stdout}\n${result.stderr}`,
	).toBe(0);

	expect(
		await pathExists(join(workspace.projectRoot, "node_modules/turbo")),
		"Production Install Kept Dev Tools: node_modules/turbo",
	).toBe(false);
}

export async function expectInstallBuildAndTypecheck(
	workspace: ScenarioProject,
	pm: "pnpm" | "npm" | "yarn" | "bun",
	installEnv?: NodeJS.ProcessEnv,
) {
	const installResult = await expectInstallAndBuild(workspace, pm, installEnv);

	const typecheckResult = await runCommand(pm, typecheckArgsFor[pm], {
		cwd: workspace.projectRoot,
		env: forgeEnvironment(workspace.workspaceRoot),
	});

	reportTurboCache(workspace, "typecheck", typecheckResult);

	expect(
		typecheckResult.exitCode,
		`${pm} typecheck failed with code ${typecheckResult.exitCode}\n${typecheckResult.stdout}\n${typecheckResult.stderr}`,
	).toBe(0);

	return installResult;
}

export async function renameModuleRoot(
	projectRoot: string,
	currentRoot: string,
	nextRoot: string,
) {
	await rename(join(projectRoot, currentRoot), join(projectRoot, nextRoot));
}
