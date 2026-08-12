import { appendFile, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { LockfileSchema, ManifestSchema } from "@ryuujs/core";
import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import {
	forgeCliPath,
	forgeEnvironment,
	pathExists,
	readJson,
	runCommand,
	tryRunForge,
	writeJson,
} from "../utils/harness";

const decodeLockfile = Schema.decodeUnknownSync(LockfileSchema);
const decodeManifest = Schema.decodeUnknownSync(ManifestSchema);

const fullConfig = {
	authentication: "better-auth",
	database: "postgresql",
	linter: "biome",
	orm: "drizzle",
	packageManager: "pnpm",
	rpc: "trpc",
	style: "tailwind",
};

type Framework = "nextjs" | "tanstack-start" | "react-router";

const frameworks: ReadonlyArray<Framework> = [
	"nextjs",
	"tanstack-start",
	"react-router",
];

function n1ScratchRoot() {
	const scratchRoot = process.env.FORGE_N1_SCRATCH_ROOT;
	if (scratchRoot === undefined)
		throw new Error(
			"FORGE_N1_SCRATCH_ROOT must point to an isolated scratch directory.",
		);

	return scratchRoot;
}

function baselineCliPath() {
	const cliPath = process.env.FORGE_N1_BASELINE_CLI;
	if (cliPath === undefined)
		throw new Error(
			"FORGE_N1_BASELINE_CLI must point to the baseline CLI build.",
		);

	return cliPath;
}

function todayCliPath() {
	return process.env.FORGE_N1_TODAY_CLI ?? forgeCliPath;
}

async function createWithBaseline(
	workspaceRoot: string,
	projectRoot: string,
	web: Framework,
) {
	const configPath = join(workspaceRoot, "forge.config.json");
	await writeJson(configPath, {
		name: "acme",
		path: "./project",
		platforms: ["web"],
		runtime: "Node.js",
		slug: "acme",
		web,
		...fullConfig,
	});

	const result = await runCommand(
		"node",
		[
			baselineCliPath(),
			"create",
			"--config",
			configPath,
			"--no-install",
			"--no-git",
		],
		{
			cwd: workspaceRoot,
			env: { CI: "true", FORCE_COLOR: "0", ...forgeEnvironment(workspaceRoot) },
		},
	);

	expect(
		result.exitCode,
		`Baseline create failed with code ${result.exitCode}\n${result.stdout}\n${result.stderr}`,
	).toBe(0);
	expect(await pathExists(projectRoot)).toBe(true);
}

function userEditablePath(lockfile: typeof LockfileSchema.Type) {
	const artifact = Object.values(lockfile.artifacts).find(
		(candidate) =>
			candidate.base === undefined && /\.(?:css|ts|tsx)$/.test(candidate.path),
	);

	if (artifact === undefined)
		throw new Error("N-1 Harness: no base-less source artifact was recorded.");

	return artifact.path;
}

async function assertStateIntegrity(projectRoot: string) {
	const manifestPath = join(projectRoot, ".forge", "manifest.json");
	const lockfilePath = join(projectRoot, ".forge", "lock.json");

	const [manifestJson, lockfileJson] = await Promise.all([
		readJson<unknown>(manifestPath),
		readJson<unknown>(lockfilePath),
	]);

	const manifest = decodeManifest(manifestJson);
	const lockfile = decodeLockfile(lockfileJson);

	const moduleIds = new Set(Object.keys(manifest.modules));
	const definitionIds = new Set(
		Object.values(manifest.modules).flatMap((module) => module.definitionIds),
	);

	for (const install of manifest.installs) {
		definitionIds.add(install.definitionId);
		for (const target of install.targets)
			if (target.kind === "module")
				expect(moduleIds.has(target.moduleId)).toBe(true);
	}

	const artifactPaths = Object.values(lockfile.artifacts).map(
		(artifact) => artifact.path,
	);

	expect(new Set(artifactPaths).size).toBe(artifactPaths.length);

	for (const artifact of Object.values(lockfile.artifacts)) {
		expect(artifact.definitionIds.length).toBeGreaterThan(0);
		expect(new Set(artifact.definitionIds).size).toBe(
			artifact.definitionIds.length,
		);

		for (const definitionId of artifact.definitionIds)
			expect(definitionIds.has(definitionId)).toBe(true);

		if (artifact.base !== undefined)
			expect(
				await pathExists(
					join(projectRoot, ".forge", "bases", artifact.base.hash),
				),
			).toBe(true);
	}

	return { lockfile, manifest };
}

describe.runIf(process.env.FORGE_N1 === "1")("N-1 evolution", () => {
	it.each(frameworks)(
		"updates and extends a baseline %s project without losing user work",
		async (web) => {
			const scratchRoot = n1ScratchRoot();
			await mkdir(scratchRoot, { recursive: true });
			const workspaceRoot = await mkdtemp(join(scratchRoot, `n1-${web}-`));
			const projectRoot = join(workspaceRoot, "project");
			let succeeded = false;

			try {
				await createWithBaseline(workspaceRoot, projectRoot, web);

				const initialState = await assertStateIntegrity(projectRoot);

				const editablePath = userEditablePath(initialState.lockfile);
				const userPath = join(projectRoot, editablePath);

				const original = await readFile(userPath, "utf-8");
				const userContent = `${original}\n// N-1 harness user edit\n`;

				await appendFile(userPath, "\n// N-1 harness user edit\n", "utf-8");

				const manifestPath = join(projectRoot, ".forge", "manifest.json");
				const lockfilePath = join(projectRoot, ".forge", "lock.json");

				const [manifestBeforeUpdate, lockfileBeforeUpdate] = await Promise.all([
					readFile(manifestPath, "utf-8"),
					readFile(lockfilePath, "utf-8"),
				]);

				const update = await tryRunForge(projectRoot, ["update"], {
					cliPath: todayCliPath(),
					workspaceRoot,
				});

				if (update.exitCode !== 0) {
					const output = update.stdout + update.stderr;
					expect(output).toMatch(/conflict|modified|refus|couldn't/i);
					expect(await readFile(manifestPath, "utf-8")).toBe(
						manifestBeforeUpdate,
					);
					expect(await readFile(lockfilePath, "utf-8")).toBe(
						lockfileBeforeUpdate,
					);
				} else {
					expect(update.stderr).toBe("");
				}

				expect(await readFile(userPath, "utf-8")).toBe(userContent);
				const [manifestBeforeAdd, lockfileBeforeAdd] = await Promise.all([
					readFile(manifestPath, "utf-8"),
					readFile(lockfilePath, "utf-8"),
				]);

				const add = await tryRunForge(projectRoot, ["add", "commitlint"], {
					cliPath: todayCliPath(),
					workspaceRoot,
				});

				if (add.exitCode !== 0) {
					const output = add.stdout + add.stderr;
					expect(output).toMatch(
						/We couldn't apply this change\.[\s\S]*Forge cannot safely update these files:[\s\S]*was modified after Forge last managed it\.[\s\S]*--keep-user[\s\S]*--accept-forge/i,
					);
					expect(await readFile(manifestPath, "utf-8")).toBe(manifestBeforeAdd);
					expect(await readFile(lockfilePath, "utf-8")).toBe(lockfileBeforeAdd);
					expect(await readFile(userPath, "utf-8")).toBe(userContent);
				}

				const addWithKeepUser = await tryRunForge(
					projectRoot,
					["add", "commitlint", "--keep-user"],
					{ cliPath: todayCliPath(), workspaceRoot },
				);

				expect(
					addWithKeepUser.exitCode,
					`forge add commitlint --keep-user failed with code ${addWithKeepUser.exitCode}\n${addWithKeepUser.stdout}\n${addWithKeepUser.stderr}`,
				).toBe(0);
				expect(await readFile(userPath, "utf-8")).toBe(userContent);

				const state = await assertStateIntegrity(projectRoot);
				expect(
					state.manifest.installs.some(
						(install) => install.definitionId === "commitlint",
					),
				).toBe(true);
				expect(
					Object.values(state.lockfile.artifacts).some((artifact) =>
						artifact.definitionIds.includes("commitlint"),
					),
				).toBe(true);
				expect(Object.keys(state.manifest.modules).sort()).toEqual(
					Object.keys(initialState.manifest.modules).sort(),
				);

				for (const initialInstall of initialState.manifest.installs)
					expect(
						state.manifest.installs.some(
							(install) => install.definitionId === initialInstall.definitionId,
						),
					).toBe(true);

				succeeded = true;
			} finally {
				if (succeeded)
					await rm(workspaceRoot, { force: true, recursive: true });
			}
		},
		300_000,
	);
});
