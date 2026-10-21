import { mkdir, realpath } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { expect } from "vitest";
import { forgeEnvironment, repoRoot, runCommand, writeJson } from "./harness";

export interface PackedManifest {
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

export interface PackedPackage {
	readonly tarballPath: string;
	readonly manifest: PackedManifest;
	readonly entries: ReadonlyArray<string>;
}

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

export async function packPackage(
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

export async function installPackedForge(
	forge: PackedPackage,
	workspaceRoot: string,
): Promise<string> {
	const installRoot = join(workspaceRoot, "install");
	await writeJson(join(installRoot, "package.json"), {
		name: "forge-tarball-smoke",
		private: true,
	});

	const install = await runCommand(
		"pnpm",
		["add", `file:${forge.tarballPath}`],
		{
			cwd: installRoot,
			env: forgeEnvironment(workspaceRoot),
		},
	);

	expect(install.exitCode, `${install.stdout}\n${install.stderr}`).toBe(0);

	const installedForgeRoot = await realpath(
		join(installRoot, "node_modules", "@ryuugg", "forge"),
	);

	const realInstallRoot = await realpath(installRoot);
	expect(
		installedForgeRoot.startsWith(`${realInstallRoot}${sep}`),
		`${installedForgeRoot} must resolve inside the scratch install`,
	).toBe(true);

	const bin =
		typeof forge.manifest.bin === "string"
			? forge.manifest.bin
			: forge.manifest.bin?.forge;

	if (bin === undefined)
		throw new Error(`Missing Forge Bin: ${JSON.stringify(forge.manifest.bin)}`);

	return join(installedForgeRoot, bin);
}
