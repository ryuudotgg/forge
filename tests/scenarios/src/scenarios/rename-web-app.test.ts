import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import type { Manifest } from "@ryuugg/core";
import { describe, expect, it } from "vitest";
import {
	commitFixture,
	createProject,
	pathExists,
	readJson,
	runCommand,
	runForge,
	type ScenarioProject,
	tryRunForge,
	withScenarioWorkspace,
	writeJson,
} from "../utils/harness";

async function files(root: string) {
	const entries = await readdir(root, { recursive: true, withFileTypes: true });
	return entries
		.filter((entry) => entry.isFile())
		.map((entry) => relative(root, join(entry.parentPath, entry.name)))
		.filter((path) => !path.startsWith(".git/"));
}

async function treeHashes(root: string) {
	const hashes: Record<string, string> = {};
	for (const path of await files(root))
		hashes[path] = createHash("sha256")
			.update(await readFile(join(root, path)))
			.digest("hex");

	return hashes;
}

async function fixture(workspace: ScenarioProject, tracked = true) {
	await createProject(workspace, {
		web: "tanstack-router",
		webApps: [{ name: "site", framework: "nextjs" }],
		backend: "hono",
		rpc: "orpc",
	});

	if (!tracked) return;

	const initialized = await runCommand("git", ["init", "-q"], {
		cwd: workspace.projectRoot,
	});

	expect(initialized.exitCode, initialized.stderr).toBe(0);
	await commitFixture(workspace);
}

async function renameManifest(workspace: ScenarioProject, name = "vault") {
	const path = join(workspace.projectRoot, ".forge/manifest.json");
	const manifest = await readJson<Manifest>(path);
	await writeJson(path, {
		...manifest,
		config: {
			...manifest.config,
			webName: name,
			webApps: [{ name: "marketing", framework: "nextjs" }],
		},
	});
}

describe("web app renames", () => {
	it("finishes a two app rename after only the first folder moved", async () => {
		await withScenarioWorkspace("rename-resumed-batch", async (workspace) => {
			await fixture(workspace);
			await renameManifest(workspace);
			const { projectRoot } = workspace;
			const manifest = await readJson<Manifest>(
				join(projectRoot, ".forge/manifest.json"),
			);

			const lockfile = await readJson(join(projectRoot, ".forge/lock.json"));
			await writeJson(join(projectRoot, ".forge/state.json"), {
				manifest,
				lockfile,
			});

			await rename(
				join(projectRoot, "apps/web"),
				join(projectRoot, "apps/vault"),
			);

			const output = await runForge(projectRoot, ["update"], {
				workspaceRoot: workspace.workspaceRoot,
			});

			expect(output.exitCode).toBe(0);
			expect(await readdir(join(projectRoot, "apps"))).toEqual([
				"marketing",
				"server",
				"vault",
			]);

			const next = await readJson<Manifest>(
				join(projectRoot, ".forge/manifest.json"),
			);

			expect(Object.keys(next.modules).sort()).toEqual(
				Object.keys(manifest.modules).sort(),
			);

			expect(
				Object.values(next.modules)
					.map((module) => module.root)
					.sort(),
			).toEqual(
				Object.values(manifest.modules)
					.map((module) =>
						module.root === "apps/web"
							? "apps/vault"
							: module.root === "apps/site"
								? "apps/marketing"
								: module.root,
					)
					.sort(),
			);

			expect(await pathExists(join(projectRoot, ".forge/state.json"))).toBe(
				false,
			);
		});
	});

	it("moves both edited apps, carries their records and leaves the committed rerun clean", async () => {
		await withScenarioWorkspace("rename-web-app", async (workspace) => {
			await fixture(workspace);

			const { projectRoot } = workspace;
			const pagePath = join(projectRoot, "apps/web/src/routes/index.tsx");
			const configPath = join(projectRoot, "apps/site/next.config.ts");
			const originalPage = await readFile(pagePath, "utf8");
			const originalConfig = await readFile(configPath, "utf8");

			const page = originalPage.replace(
				'tracking-tight">acme<',
				'tracking-tight">Vault<',
			);

			const config = originalConfig.replace(
				"reactStrictMode: true,",
				'output: "export",\n  reactStrictMode: true,',
			);

			expect(page).not.toBe(originalPage);
			expect(config).not.toBe(originalConfig);
			await mkdir(join(projectRoot, "apps/site/content"));
			await writeFile(
				join(projectRoot, "apps/site/content/hello.mdx"),
				"# Hello\n",
			);

			await writeFile(pagePath, page);
			await writeFile(configPath, config);
			await commitFixture(workspace);
			const previous = await readJson<Manifest>(
				join(projectRoot, ".forge/manifest.json"),
			);

			await renameManifest(workspace);

			const output = await runForge(projectRoot, ["update"], {
				workspaceRoot: workspace.workspaceRoot,
			});

			expect(output.exitCode).toBe(0);
			expect(output.stdout).toContain(
				"We moved apps/web to apps/vault and apps/site to apps/marketing.",
			);

			expect(await readdir(join(projectRoot, "apps"))).toEqual([
				"marketing",
				"server",
				"vault",
			]);

			expect(await pathExists(join(projectRoot, "apps/web"))).toBe(false);
			expect(await pathExists(join(projectRoot, "apps/site"))).toBe(false);
			expect(
				await readFile(join(projectRoot, "apps/marketing/content/hello.mdx")),
			).toEqual(Buffer.from("# Hello\n"));

			expect(
				await readFile(join(projectRoot, "apps/marketing/next.config.ts")),
			).toEqual(Buffer.from(config));

			expect(
				await readFile(join(projectRoot, "apps/vault/src/routes/index.tsx")),
			).toEqual(Buffer.from(page));

			const next = await readJson<Manifest>(
				join(projectRoot, ".forge/manifest.json"),
			);

			expect(Object.keys(next.modules).sort()).toEqual(
				Object.keys(previous.modules).sort(),
			);

			for (const path of await files(projectRoot)) {
				const content = await readFile(join(projectRoot, path), "utf8");
				expect(`${path}\n${content}`, path).not.toMatch(
					/apps\/web|apps\/site|@acme\/web|@acme\/site/,
				);
			}

			await commitFixture(workspace);
			await runForge(projectRoot, ["update"], {
				workspaceRoot: workspace.workspaceRoot,
			});

			const status = await runCommand("git", ["status", "--porcelain=v1"], {
				cwd: projectRoot,
			});

			expect(status.exitCode).toBe(0);
			expect(status.stdout).toBe("");
		});
	});

	it.each([
		{
			kind: "clash",
			name: "marketing",
			sentence: "marketing names both the primary web app and a secondary one.",
		},
		{
			kind: "reserved",
			name: "server",
			sentence: "server is reserved, so pick another name for this web app.",
		},
		{
			kind: "dirty",
			name: "vault",
			sentence: "uncommitted changes in README.md",
		},
		{ kind: "occupied", name: "vault", sentence: "apps/vault already exists" },
		{
			kind: "untracked",
			name: "vault",
			sentence: "until Git tracks this project",
		},
	])(
		"refuses $kind without changing any bytes",
		async ({ kind, name, sentence }) => {
			await withScenarioWorkspace(`rename-${kind}`, async (workspace) => {
				await fixture(workspace, kind !== "untracked");
				await renameManifest(workspace, name);

				if (kind === "dirty")
					await writeFile(
						join(workspace.projectRoot, "README.md"),
						"user edit\n",
					);

				if (kind === "occupied")
					await mkdir(join(workspace.projectRoot, "apps/vault"));

				const before = await treeHashes(workspace.projectRoot);

				const output = await tryRunForge(workspace.projectRoot, ["update"], {
					workspaceRoot: workspace.workspaceRoot,
				});

				expect(output.exitCode).toBe(1);
				expect(output.stdout).toContain(sentence);
				expect(await treeHashes(workspace.projectRoot)).toEqual(before);
			});
		},
	);

	it.each(["add", "remove"])(
		"asks for update before %s consumes the pending rename",
		async (command) => {
			await withScenarioWorkspace(
				`rename-before-${command}`,
				async (workspace) => {
					await fixture(workspace);

					if (command === "remove")
						await runForge(
							workspace.projectRoot,
							["add", "vitest", "--no-install"],
							{ workspaceRoot: workspace.workspaceRoot },
						);

					await renameManifest(workspace);
					const before = await treeHashes(workspace.projectRoot);

					const output = await tryRunForge(
						workspace.projectRoot,
						[command, "vitest", "--no-install"],
						{ workspaceRoot: workspace.workspaceRoot },
					);

					expect(output.exitCode).toBe(1);
					expect(output.stdout).toContain(
						"Run forge update first to move apps/web to apps/vault and apps/site to apps/marketing.",
					);

					expect(await treeHashes(workspace.projectRoot)).toEqual(before);
				},
			);
		},
	);
});
