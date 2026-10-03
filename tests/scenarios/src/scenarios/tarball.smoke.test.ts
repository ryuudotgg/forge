import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	addAddon,
	createProject,
	forgeEnvironment,
	pathExists,
	readJson,
	runCommand,
	updateProject,
	withScenarioWorkspace,
} from "../utils/harness";
import {
	installPackedForge,
	type PackedPackage,
	packPackage,
} from "../utils/packed";

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
					if (name.startsWith("@ryuugg/"))
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
			const generators = packedPackage(packages, "@ryuugg/generators");
			for (const dependencies of [
				forge.manifest.dependencies,
				forge.manifest.peerDependencies,
				forge.manifest.optionalDependencies,
			])
				expect(
					dependencies ?? {},
					"The CLI bundles its runtime, so its tarball must declare no installable dependencies",
				).toEqual({});

			for (const { manifest, entries } of [forge, generators])
				expect(
					entries.some((entry) => entry.startsWith("package/templates/")),
					`${manifest.name} must ship package/templates/ so the installed CLI can scaffold projects`,
				).toBe(true);

			const cliPath = await installPackedForge(forge, workspace.workspaceRoot);

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
