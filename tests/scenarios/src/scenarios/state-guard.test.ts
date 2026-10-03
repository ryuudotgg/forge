import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
	createProject,
	readJson,
	tryRunForge,
	withScenarioWorkspace,
	writeJson,
} from "../utils/harness";

describe("state guard", () => {
	it("stamps the CLI version and refuses newer state without writing", async () => {
		await withScenarioWorkspace("state-version-guard", async (workspace) => {
			await createProject(workspace, {
				orm: "drizzle",
				packageManager: "pnpm",
				web: "nextjs",
			});

			const manifestPath = join(workspace.projectRoot, ".forge/manifest.json");
			const lockfilePath = join(workspace.projectRoot, ".forge/lock.json");
			const manifest = await readJson<{
				cliVersion: string;
				installs: Array<{ definitionId: string }>;
			}>(manifestPath);

			const cliPackage = await readJson<{ version: string }>(
				fileURLToPath(
					new URL("../../../../packages/cli/package.json", import.meta.url),
				),
			);

			expect(manifest.cliVersion).toBe(cliPackage.version);
			const installedAddon = manifest.installs.find(
				(install) => install.definitionId === "drizzle",
			);

			expect(installedAddon).toBeDefined();

			if (installedAddon === undefined)
				throw new Error("Expected Installed Drizzle Addon");

			const rawManifest = await readFile(manifestPath, "utf-8");
			expect(rawManifest.split('"schemaVersion": 1')).toHaveLength(2);
			await writeFile(
				manifestPath,
				rawManifest.replace('"schemaVersion": 1', '"schemaVersion": 99'),
			);

			const manifestBefore = await readFile(manifestPath);
			const lockfileBefore = await readFile(lockfilePath);
			for (const args of [
				["add", "commitlint", "--no-install"],
				["remove", installedAddon.definitionId],
				["update"],
				["list"],
				["init"],
			]) {
				const result = await tryRunForge(workspace.projectRoot, args, {
					workspaceRoot: workspace.workspaceRoot,
				});

				expect(result.exitCode).not.toBe(0);
				expect(result.stdout + result.stderr).toContain(
					"We can't read this project's metadata because it was saved by a different version of Forge.",
				);

				expect(await readFile(manifestPath)).toEqual(manifestBefore);
				expect(await readFile(lockfilePath)).toEqual(lockfileBefore);
			}
		});
	}, 240_000);

	it("rejects an add when the manifest config is blank", async () => {
		await withScenarioWorkspace("state-guard", async (workspace) => {
			await createProject(workspace, {
				orm: "drizzle",
				packageManager: "pnpm",
				web: "nextjs",
			});

			const manifestPath = join(workspace.projectRoot, ".forge/manifest.json");
			const manifest = await readJson<{
				config?: Record<string, unknown>;
				installs: Array<{ definitionId: string }>;
				modules: Record<string, unknown>;
			}>(manifestPath);

			expect(manifest.installs.length).toBeGreaterThan(0);

			delete manifest.config;
			await writeJson(manifestPath, manifest);

			const result = await tryRunForge(
				workspace.projectRoot,
				["add", "commitlint"],
				{ workspaceRoot: workspace.workspaceRoot },
			);

			expect(result.exitCode).not.toBe(0);
			expect(result.stdout + result.stderr).toContain(
				"We couldn't find a Forge project here. The .forge directory is missing or incomplete.",
			);
		});
	}, 240_000);
});
