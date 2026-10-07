import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { ForgeConfig } from "../src";
import { plannedProject } from "./planner-harness";

const fullConfig: ForgeConfig = {
	slug: "acme",
	packageManager: "pnpm",
	web: "tanstack-router",
	webApps: [{ name: "site", framework: "nextjs" }],
	backend: "hono",
	rpc: "orpc",
	orm: "drizzle",
	database: "postgresql",
	authentication: "better-auth",
	authMethods: ["passkey", "email-otp"],
	authPlugins: ["polar"],
	emailProvider: "resend",
	addons: ["vitest"],
};

const stanza = join(
	dirname(
		createRequire(import.meta.url).resolve("@ryuugg/stanza/package.json"),
	),
	"src/launcher",
);

const directories: Array<string> = [];

afterAll(async () => {
	await Promise.all(
		directories
			.splice(0)
			.map((directory) => rm(directory, { recursive: true, force: true })),
	);
});

describe("generated TypeScript layout", () => {
	it("passes stanza --check in every generated TS and TSX file", async () => {
		const plan = await plannedProject(fullConfig);
		const directory = await mkdtemp(join(tmpdir(), "forge-stanza-"));

		directories.push(directory);
		await Promise.all(
			plan.writes.map(async (write) => {
				const path = join(directory, write.path);
				await mkdir(dirname(path), { recursive: true });
				await writeFile(path, write.content);
			}),
		);

		const sources = plan.writes
			.map((write) => write.path)
			.filter((path) => /\.tsx?$/.test(path));

		expect(sources).toEqual(
			expect.arrayContaining([
				"apps/web/src/orpc/react.tsx",
				"packages/orpc/src/orpc.ts",
				"packages/auth/env.ts",
				"packages/auth/src/background.ts",
			]),
		);

		const result = spawnSync(stanza, ["--check", "--json", "--", ...sources], {
			cwd: directory,
			encoding: "utf8",
		});

		const findings: Array<{ path: string; line: number; rule: string }> =
			result.stdout.trim() === "" ? [] : JSON.parse(result.stdout);

		expect(
			findings.map(
				(finding) => `${finding.path}:${finding.line} ${finding.rule}`,
			),
		).toEqual([]);

		expect(result.status, result.stderr).toBe(0);
	});
});
