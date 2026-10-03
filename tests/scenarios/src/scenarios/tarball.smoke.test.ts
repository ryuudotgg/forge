import { mkdir, realpath, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve, sep } from "node:path";
import { describe, expect, it } from "vitest";
import {
	addAddon,
	createProject,
	forgeEnvironment,
	pathExists,
	readJson,
	repoRoot,
	runCommand,
	updateProject,
	withScenarioWorkspace,
	writeJson,
} from "../utils/harness";

interface PackedManifest {
	readonly name: string;
	readonly version: string;
	readonly bin?: string | Readonly<Record<string, string>>;
	readonly dependencies?: Readonly<Record<string, string>>;
	readonly devDependencies?: Readonly<Record<string, string>>;
	readonly peerDependencies?: Readonly<Record<string, string>>;
	readonly optionalDependencies?: Readonly<Record<string, string>>;
}

interface PackOutput {
	readonly filename: string;
}

interface PackedPackage {
	readonly tarballPath: string;
	readonly manifest: PackedManifest;
	readonly entries: ReadonlyArray<string>;
}

interface ProjectManifest {
	readonly installs: ReadonlyArray<{ readonly definitionId: string }>;
}

const releasePackages: ReadonlyArray<{
	readonly dir: string;
	readonly name: string;
}> = [
	{ dir: "cli", name: "@ryuugg/forge" },
	{ dir: "core", name: "@ryuugg/core" },
	{ dir: "generators", name: "@ryuugg/generators" },
];

async function readPackedManifest(
	tarballPath: string,
	cwd: string,
): Promise<PackedManifest> {
	const result = await runCommand(
		"tar",
		["-xOzf", tarballPath, "package/package.json"],
		{ cwd },
	);

	expect(result.exitCode, `${result.stdout}\n${result.stderr}`).toBe(0);

	return JSON.parse(result.stdout);
}

async function packPackage(
	dir: string,
	workspaceRoot: string,
): Promise<PackedPackage> {
	const destination = join(workspaceRoot, "tarballs");
	await mkdir(destination, { recursive: true });
	const result = await runCommand(
		"pnpm",
		["pack", "--json", "--pack-destination", destination],
		{
			cwd: join(repoRoot, "packages", dir),
		},
	);

	expect(result.exitCode, `${result.stdout}\n${result.stderr}`).toBe(0);
	const output: PackOutput = JSON.parse(result.stdout);
	const tarballPath = resolve(destination, output.filename);

	const manifest = await readPackedManifest(tarballPath, workspaceRoot);
	const listing = await runCommand("tar", ["-tzf", tarballPath], {
		cwd: workspaceRoot,
	});

	expect(listing.exitCode, `${listing.stdout}\n${listing.stderr}`).toBe(0);

	return { tarballPath, manifest, entries: listing.stdout.trim().split("\n") };
}

function packedPackage(
	packages: Readonly<Record<string, PackedPackage>>,
	name: string,
): PackedPackage {
	const packed = packages[name];
	if (!packed) throw new Error(`Packed Package Not Found: ${name}`);
	return packed;
}

describe.runIf(process.env.FORGE_SMOKE === "1")("tarball release smoke", () => {
	it("installs the packed tarballs and runs create, add and update through the installed binary", async () => {
		await withScenarioWorkspace("smoke-tarball", async (workspace) => {
			const packages: Record<string, PackedPackage> = {};
			for (const packageDefinition of releasePackages)
				packages[packageDefinition.name] = await packPackage(
					packageDefinition.dir,
					workspace.workspaceRoot,
				);

			for (const { manifest, entries } of Object.values(packages)) {
				for (const dependencies of [
					manifest.dependencies,
					manifest.devDependencies,
					manifest.peerDependencies,
					manifest.optionalDependencies,
				])
					for (const [name, version] of Object.entries(dependencies ?? {}))
						expect(
							version,
							`${manifest.name} ${name} must not retain a workspace or catalog protocol`,
						).not.toMatch(/^(workspace:|catalog:)/);

				for (const [name, version] of Object.entries(
					manifest.dependencies ?? {},
				))
					if (name.startsWith("@ryuujs/"))
						expect(
							version,
							`${manifest.name} must pin ${name} to its packed version`,
						).toBe(packedPackage(packages, name).manifest.version);

				expect(
					entries,
					`${manifest.name} must ship its built entry point`,
				).toContain("package/dist/index.mjs");
			}

			const forge = packedPackage(packages, "@ryuugg/forge");
			const core = packedPackage(packages, "@ryuugg/core");
			const generators = packedPackage(packages, "@ryuugg/generators");
			expect(
				generators.entries.some((entry) =>
					entry.startsWith("package/templates/"),
				),
				"The generators tarball must ship package/templates/ so the installed CLI can scaffold projects",
			).toBe(true);

			const installRoot = join(workspace.workspaceRoot, "install");
			await writeJson(join(installRoot, "package.json"), {
				name: "forge-tarball-smoke",
				private: true,
			});

			await writeFile(
				join(installRoot, "pnpm-workspace.yaml"),
				`overrides:\n  "@ryuugg/core": ${JSON.stringify(`file:${core.tarballPath}`)}\n  "@ryuugg/generators": ${JSON.stringify(`file:${generators.tarballPath}`)}\n`,
				"utf-8",
			);

			const install = await runCommand(
				"pnpm",
				["add", `file:${forge.tarballPath}`],
				{
					cwd: installRoot,
					env: forgeEnvironment(workspace.workspaceRoot),
				},
			);

			expect(install.exitCode, `${install.stdout}\n${install.stderr}`).toBe(0);

			const installedForgeRoot = await realpath(
				join(installRoot, "node_modules", "@ryuujs", "forge"),
			);

			const forgeRequire = createRequire(
				join(installedForgeRoot, "package.json"),
			);

			const installedCorePath = await realpath(
				forgeRequire.resolve("@ryuugg/core"),
			);

			const installedGeneratorsPath = await realpath(
				forgeRequire.resolve("@ryuugg/generators"),
			);

			const generatorsRequire = createRequire(
				join(dirname(dirname(installedGeneratorsPath)), "package.json"),
			);

			const generatorsCorePath = await realpath(
				generatorsRequire.resolve("@ryuugg/core"),
			);

			const realInstallRoot = await realpath(installRoot);
			const realRepoRoot = await realpath(repoRoot);
			for (const installedPath of [
				installedForgeRoot,
				installedCorePath,
				installedGeneratorsPath,
				generatorsCorePath,
			]) {
				expect(
					installedPath.startsWith(`${realInstallRoot}${sep}`),
					`${installedPath} must resolve inside the scratch install`,
				).toBe(true);

				expect(
					installedPath.startsWith(`${realRepoRoot}${sep}`),
					`${installedPath} must not resolve into the repo`,
				).toBe(false);
			}

			const bin =
				typeof forge.manifest.bin === "string"
					? forge.manifest.bin
					: forge.manifest.bin?.forge;

			if (bin === undefined)
				throw new Error(
					`Missing Forge Bin: ${JSON.stringify(forge.manifest.bin)}`,
				);

			const cliPath = join(installedForgeRoot, bin);

			const directRun = await runCommand(cliPath, ["--version"], {
				cwd: workspace.workspaceRoot,
				env: forgeEnvironment(workspace.workspaceRoot),
			});

			expect(
				directRun.exitCode,
				`The installed bin must run on its own, as npm and npx invoke it\n${directRun.stdout}\n${directRun.stderr}`,
			).toBe(0);

			await createProject(workspace, { packageManager: "pnpm" }, { cliPath });
			const manifestPath = join(
				workspace.projectRoot,
				".forge",
				"manifest.json",
			);

			const biomePath = join(workspace.projectRoot, "biome.json");
			expect(await pathExists(manifestPath)).toBe(true);
			expect(await pathExists(biomePath)).toBe(false);

			await addAddon(workspace.projectRoot, "biome", { cliPath });
			expect(await pathExists(biomePath)).toBe(true);
			const addedManifest = await readJson<ProjectManifest>(manifestPath);
			expect(
				addedManifest.installs.some(
					(install) => install.definitionId === "biome",
				),
			).toBe(true);

			await updateProject(workspace.projectRoot, { cliPath });
			const updatedManifest = await readJson<ProjectManifest>(manifestPath);
			expect(
				updatedManifest.installs.some(
					(install) => install.definitionId === "biome",
				),
			).toBe(true);

			expect(
				await pathExists(join(workspace.projectRoot, ".forge", "lock.json")),
			).toBe(true);
		});
	}, 600_000);
});
