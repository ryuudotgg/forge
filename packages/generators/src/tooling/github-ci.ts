import { defineAddon, leafTextFile, projectTarget } from "@ryuujs/core";
import type { ForgeConfig } from "../config";
import type { FirstPartyAddonMetadata } from "../registry/types";
import { readTemplate } from "../template";

const githubCi = defineAddon<ForgeConfig, "github-ci">({
	id: "github-ci",
	name: "GitHub CI",
	version: "0.1.0",
	category: "tooling",
	exclusive: false,
	targetMode: "single",
	when: () => true,
	contribute: ({ config }) => {
		const slug = config.slug ?? "my-app";

		return [
			leafTextFile(
				projectTarget(),
				".github/workflows/ci.yml",
				readTemplate("tooling/github/ci.yml"),
			),
			leafTextFile(
				projectTarget(),
				"tooling/github/setup/action.yml",
				readTemplate("tooling/github/setup-action.yml"),
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
