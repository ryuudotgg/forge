import { join } from "node:path";
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
} from "../utils/harness";
import { installPackedForge, packPackage } from "../utils/packed";

interface ProjectManifest {
	readonly installs: ReadonlyArray<{ readonly definitionId: string }>;
}

const workspacePackages = ["core", "generators"];

describe.runIf(process.env.FORGE_SMOKE === "1")("tarball release smoke", () => {
	it("installs the packed CLI tarball and runs create, add and update through the installed binary", async () => {
		await withScenarioWorkspace("smoke-tarball", async (workspace) => {
			for (const dir of workspacePackages) {
				const manifest = await readJson<{ readonly private?: boolean }>(
					join(repoRoot, "packages", dir, "package.json"),
				);

				expect(
					manifest.private,
					`packages/${dir} is bundled into @ryuugg/forge and must stay private`,
				).toBe(true);
			}

			const forge = await packPackage("cli", workspace.workspaceRoot);
			for (const dependencies of [
				forge.manifest.dependencies,
				forge.manifest.peerDependencies,
				forge.manifest.optionalDependencies,
			])
				expect(
					dependencies ?? {},
					"The CLI bundles its runtime, so its tarball must declare no installable dependencies",
				).toEqual({});

			for (const [name, version] of Object.entries(
				forge.manifest.devDependencies ?? {},
			))
				expect(
					version,
					`@ryuugg/forge ${name} must not retain a workspace or catalog protocol`,
				).not.toMatch(/^(workspace:|catalog:)/);

			expect(
				forge.entries,
				"@ryuugg/forge must ship its built entry point",
			).toContain("package/dist/index.mjs");

			expect(
				forge.entries.some((entry) => entry.startsWith("package/templates/")),
				"@ryuugg/forge must ship package/templates/ so the installed CLI can scaffold projects",
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
