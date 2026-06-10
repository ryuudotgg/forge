import { defineAddon, leafTextFile, projectTarget } from "@ryuujs/core";
import { type ForgeConfig, hasAddon } from "../config";
import { pmRun, resolvePackageManager } from "../pm";
import type { FirstPartyAddonMetadata } from "../registry/types";
import { interpolate, readTemplate } from "../template";

const githubCi = defineAddon<ForgeConfig, "github-ci">({
	id: "github-ci",
	name: "GitHub CI",
	version: "0.1.0",
	category: "tooling",
	exclusive: false,
	targetMode: "single",
	when: (config) => hasAddon(config, "github-ci"),
	contribute: ({ config }) => {
		const slug = config.slug ?? "my-app";
		const pm = resolvePackageManager(config);

		return [
			leafTextFile(
				projectTarget(),
				".github/workflows/ci.yml",
				interpolate(readTemplate("tooling/github/ci.yml"), {
					CHECK_COMMAND: pmRun(pm, "check"),
					CHECK_WS_COMMAND: pmRun(pm, "check:ws"),
					TYPECHECK_COMMAND: pmRun(pm, "typecheck"),
				}),
			),
			leafTextFile(
				projectTarget(),
				"tooling/github/setup/action.yml",
				readTemplate(`tooling/github/setup-action.${pm}.yml`),
			),
			leafTextFile(
				projectTarget(),
				"tooling/github/package.json",
				`${JSON.stringify({ name: `@${slug}/github`, private: true }, null, 2)}\n`,
			),
		];
	},
});

export const githubCiMetadata = {
	description:
		"GitHub Actions CI workflow plus a reusable setup composite action.",
	experimental: false,
	hidden: false,
	id: "github-ci",
	keywords: ["ci", "github", "tooling"],
	kind: "addon",
	name: "GitHub CI",
	summary: "Add GitHub Actions CI.",
} as const satisfies FirstPartyAddonMetadata;

export default githubCi;
