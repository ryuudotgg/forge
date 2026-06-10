import {
	defineAddon,
	leafTextFile,
	projectTarget,
	surfaceDependencies,
} from "@ryuujs/core";
import { type ForgeConfig, hasAddon } from "../config";
import { deps } from "../deps";
import type { FirstPartyAddonMetadata } from "../registry/types";
import { readTemplate } from "../template";

const commitlint = defineAddon<ForgeConfig, "commitlint">({
	id: "commitlint",
	name: "commitlint",
	version: "0.1.0",
	category: "tooling",
	exclusive: false,
	targetMode: "single",
	when: (config) => hasAddon(config, "commitlint"),
	contribute: () => [
		leafTextFile(
			projectTarget(),
			"commitlint.config.ts",
			readTemplate("tooling/commitlint/commitlint.config.ts"),
		),
		surfaceDependencies(projectTarget(), "rootPackageJson", [
			{ ...deps.commitlintCli, type: "devDependencies" },
			{ ...deps.commitlintConfigConventional, type: "devDependencies" },
			{ ...deps.commitlintTypes, type: "devDependencies" },
		]),
	],
});

export const commitlintMetadata = {
	description:
		"Conventional commits enforcement via commitlint with config-conventional rules.",
	experimental: false,
	hidden: false,
	id: "commitlint",
	keywords: ["commitlint", "conventional", "tooling"],
	kind: "addon",
	name: "commitlint",
	summary: "Enforce conventional commits.",
} as const satisfies FirstPartyAddonMetadata;

export default commitlint;
