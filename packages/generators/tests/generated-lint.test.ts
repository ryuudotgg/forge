import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ForgeConfig } from "../src";
import { plannedProject } from "./planner-harness";

const resolve = createRequire(import.meta.url).resolve;

const bin = (name: string) =>
	join(dirname(resolve(`${name}/package.json`)), "bin", basename(name));

const tools = {
	biome: bin("@biomejs/biome"),
	oxlint: bin("oxlint"),
	oxfmt: bin("oxfmt"),
};

const singleThreaded = { ...process.env, RAYON_NUM_THREADS: "1" };

const checks = {
	biome: [[tools.biome, "check", ".", "--error-on-warnings"]],
	oxc: [
		[tools.oxlint, "--deny-warnings"],
		[tools.oxfmt, "--check"],
	],
} as const;

function meisaiConfig(slug: string, linter: "biome" | "oxc"): ForgeConfig {
	return {
		authentication: "better-auth",
		authMethods: ["passkey", "email-otp"],
		authPlugins: ["polar"],
		backend: "hono",
		database: "sqlite",
		emailProvider: "resend",
		linter,
		name: slug,
		orm: "drizzle",
		packageManager: "pnpm",
		platforms: ["web"],
		rpc: "trpc",
		runtime: "Node.js",
		slug,
		style: "tailwind",
		web: "nextjs",
		webApps: [{ name: "site", framework: "nextjs" }],
	};
}

async function writeProject(config: ForgeConfig) {
	const plan = await plannedProject(config);
	const root = await mkdtemp(join(tmpdir(), "forge-generated-lint-"));
	for (const write of plan.writes) {
		const path = join(root, write.path);
		await mkdir(dirname(path), { recursive: true });
		await writeFile(path, write.content);
	}

	return root;
}

describe("generated lint", () => {
	it.each([
		{ slug: "meisai", linter: "biome" },
		{ slug: "meisai", linter: "oxc" },
		{ slug: "hono-api", linter: "biome" },
		{ slug: "hono-api", linter: "oxc" },
		{ slug: "trpc", linter: "biome" },
		{ slug: "trpc", linter: "oxc" },
	] as const)(
		"passes $linter as generated for the $slug Hono project",
		async ({ slug, linter }) => {
			const root = await writeProject(meisaiConfig(slug, linter));
			try {
				for (const [command, ...args] of checks[linter]) {
					const result = spawnSync(process.execPath, [command, ...args], {
						cwd: root,
						encoding: "utf-8",
						env: singleThreaded,
					});

					expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
				}
			} finally {
				await rm(root, { force: true, recursive: true });
			}
		},
		60_000,
	);
});
