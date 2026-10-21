import {
	defineAddon,
	ensuredModuleTarget,
	leafTextFile,
	projectTarget,
	surfaceDependencies,
	surfaceJson,
	surfaceScripts,
} from "@ryuugg/core";
import { type ForgeConfig, hasAddon } from "../config";
import type { FirstPartyAddonMetadata } from "../registry/types";
import { readTemplate } from "../template";
import { catalogRef } from "../versions";
import { primaryWebAppName } from "../web-apps";

const vitest = defineAddon<ForgeConfig, "vitest">({
	id: "vitest",
	name: "Vitest",
	version: "0.1.0",
	category: "tooling",
	exclusive: false,
	targetMode: "single",
	when: (config) => hasAddon(config, "vitest") && config.web !== undefined,
	contribute: ({ config }) => {
		if (config.web === undefined) return [];

		return [
			leafTextFile(
				ensuredModuleTarget(primaryWebAppName(config)),
				"vitest.config.ts",
				readTemplate("tooling/vitest/vitest.config.ts"),
			),
			surfaceDependencies(
				ensuredModuleTarget(primaryWebAppName(config)),
				"packageJson",
				[{ ...catalogRef("vitest"), type: "devDependencies" }],
			),
			surfaceScripts(
				ensuredModuleTarget(primaryWebAppName(config)),
				"packageJson",
				{
					test: "vitest run",
				},
			),
			surfaceScripts(projectTarget(), "rootPackageJson", {
				test: "turbo run test",
			}),
			surfaceJson(projectTarget(), "workspaceConfig", {
				tasks: { test: { dependsOn: ["^test"] } },
			}),
			leafTextFile(
				ensuredModuleTarget(primaryWebAppName(config)),
				"src/forge.test.ts",
				readTemplate("tooling/vitest/src/forge.test.ts"),
			),
		];
	},
});

export const vitestMetadata = {
	description:
		"Vitest setup for fast, framework-agnostic tests in the generated web app.",
	experimental: false,
	hidden: false,
	id: "vitest",
	keywords: ["test", "testing", "tooling", "vitest"],
	kind: "addon",
	name: "Vitest",
	summary: "Test the generated web app with Vitest.",
} as const satisfies FirstPartyAddonMetadata;

export default vitest;
