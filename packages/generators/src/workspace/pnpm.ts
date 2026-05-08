import { defineAddon, leafTextFile, projectTarget } from "@ryuujs/core";
import type { ForgeConfig } from "../config";
import type { FirstPartyAddonMetadata } from "../registry/types";

const pnpm = defineAddon<ForgeConfig, "pnpm">({
	id: "pnpm",
	name: "pnpm Workspace",
	version: "0.1.0",
	category: "packageManager",
	exclusive: true,
	targetMode: "single",
	when: (config) =>
		config.packageManager === "pnpm" || config.packageManager === undefined,
	contribute: () => [
		leafTextFile(
			projectTarget(),
			"pnpm-workspace.yaml",
			"packages:\n  - apps/*\n  - packages/*\n",
		),
	],
});

export const pnpmMetadata = {
	description:
		"Configures pnpm workspace behavior and workspace package manager metadata.",
	experimental: false,
	hidden: false,
	id: "pnpm",
	keywords: ["package manager", "pnpm", "workspace"],
	kind: "addon",
	name: "pnpm Workspace",
	summary: "Set up pnpm workspace support.",
} as const satisfies FirstPartyAddonMetadata;

export default pnpm;
