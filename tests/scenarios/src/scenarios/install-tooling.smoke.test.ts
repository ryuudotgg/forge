import { describe, it } from "vitest";
import { createProject, withScenarioWorkspace } from "../utils/harness";
import { expectFreshLinterCheck, expectLinterSwitch } from "../utils/linter";

describe.runIf(process.env.FORGE_SMOKE === "1")("install smoke", () => {
	it.each([
		{
			from: "biome",
			to: "oxc",
			surfaces: {
				configFiles: [".oxlintrc.json", ".oxfmtrc.json"],
				devDependencies: ["oxlint", "oxfmt"],
				absentConfigFiles: ["biome.json"],
				absentDevDependencies: ["@biomejs/biome"],
			},
		},
		{
			from: "oxc",
			to: "biome",
			surfaces: {
				configFiles: ["biome.json"],
				devDependencies: ["@biomejs/biome"],
				absentConfigFiles: [".oxlintrc.json", ".oxfmtrc.json"],
				absentDevDependencies: ["oxlint", "oxfmt"],
			},
		},
	])(
		"switches $from to $to on the default preset",
		async ({ from, to, surfaces }) => {
			await withScenarioWorkspace(
				`smoke-switch-${from}-${to}`,
				async (workspace) => {
					await createProject(workspace, {
						addons: ["commitlint", "github-ci", "lefthook", "vscode"],
						authentication: "better-auth",
						backend: "self",
						catalogs: "scoped",
						database: "postgresql",
						databaseProvider: "neon",
						orm: "drizzle",
						rpc: "trpc",
						style: "tailwind",
						uiLibrary: "base-ui",
						web: "nextjs",
						linter: from,
						packageManager: "pnpm",
					});

					await expectLinterSwitch(workspace, { to, surfaces });
				},
			);
		},
		600_000,
	);

	it.each([
		{
			name: "default",
			config: {
				addons: ["commitlint", "github-ci", "lefthook", "vscode"],
				authentication: "better-auth",
				backend: "self",
				catalogs: "scoped",
				database: "postgresql",
				databaseProvider: "neon",
				orm: "drizzle",
				rpc: "trpc",
				style: "tailwind",
				uiLibrary: "base-ui",
				web: "nextjs",
			},
		},
		{
			name: "full-stack",
			config: {
				addons: ["commitlint", "github-ci", "lefthook", "vscode"],
				authentication: "better-auth",
				authMethods: ["email-password", "passkey", "email-otp"],
				backend: "hono",
				catalogs: "scoped",
				database: "sqlite",
				emailProvider: "resend",
				orm: "drizzle",
				rpc: "orpc",
				style: "tailwind",
				uiLibrary: "base-ui",
				web: "tanstack-router",
				webApps: [{ name: "admin", framework: "nextjs" }],
			},
		},
	])(
		"passes its own Oxc check on a fresh $name project",
		async ({ name, config }) => {
			await withScenarioWorkspace(`smoke-oxc-${name}`, async (workspace) => {
				await createProject(workspace, {
					...config,
					linter: "oxc",
					packageManager: "pnpm",
				});

				await expectFreshLinterCheck(workspace, {
					configFiles: [".oxlintrc.json", ".oxfmtrc.json"],
					devDependencies: ["oxlint", "oxfmt"],
					absentConfigFiles: ["biome.json"],
					absentDevDependencies: ["@biomejs/biome"],
				});
			});
		},
		600_000,
	);
});
