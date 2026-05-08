import { spawn } from "node:child_process";
import {
	access,
	mkdir,
	mkdtemp,
	readFile,
	rename,
	rm,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const forgeCliPath = resolve(
	process.cwd(),
	"..",
	"..",
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

export function forgeEnvironment(workspaceRoot: string): NodeJS.ProcessEnv {
	const cacheRoot = join(workspaceRoot, ".cache");

	return {
		FORGE_CACHE_DIR: join(cacheRoot, "forge"),
		XDG_CACHE_HOME: join(cacheRoot, "xdg"),
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
				exitCode: code ?? 0,
				stderr,
				stdout,
			});
		});

		if (options.input) child.stdin.write(options.input);
		child.stdin.end();
	});
}

export async function runForge(
	cwd: string,
	args: ReadonlyArray<string>,
	options?: {
		readonly env?: NodeJS.ProcessEnv;
		readonly input?: string;
		readonly workspaceRoot?: string;
	},
) {
	const result = await runCommand("node", [forgeCliPath, ...args], {
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
		readonly env?: NodeJS.ProcessEnv;
	},
) {
	const configPath = join(workspace.workspaceRoot, "forge.config.json");

	await writeJson(configPath, {
		name: "acme",
		path: "./project",
		platforms: ["web"],
		runtime: "Node.js",
		slug: "acme",
		...config,
	});

	await runForge(
		workspace.workspaceRoot,
		["create", "--config", configPath, "--no-install", "--no-git"],
		{ env: options?.env, workspaceRoot: workspace.workspaceRoot },
	);
}

export async function addAddon(
	projectRoot: string,
	addonId: string,
	options?: {
		readonly env?: NodeJS.ProcessEnv;
	},
) {
	await runForge(projectRoot, ["add", addonId], {
		env: options?.env,
		workspaceRoot: dirname(projectRoot),
	});
}

export async function removeAddon(
	projectRoot: string,
	addonId: string,
	options?: {
		readonly env?: NodeJS.ProcessEnv;
	},
) {
	await runForge(projectRoot, ["remove", addonId], {
		env: options?.env,
		workspaceRoot: dirname(projectRoot),
	});
}

export async function updateProject(
	projectRoot: string,
	options?: {
		readonly env?: NodeJS.ProcessEnv;
	},
) {
	await runForge(projectRoot, ["update"], {
		env: options?.env,
		workspaceRoot: dirname(projectRoot),
	});
}

export async function renameModuleRoot(
	projectRoot: string,
	currentRoot: string,
	nextRoot: string,
) {
	await rename(join(projectRoot, currentRoot), join(projectRoot, nextRoot));
}
