import {
	defineAddon,
	leafTextFile,
	projectTarget,
	surfaceLines,
} from "@ryuujs/core";
import type { ForgeConfig } from "../config";
import type { FirstPartyAddonMetadata } from "../registry/types";

const yarn = defineAddon<ForgeConfig, "yarn">({
	id: "yarn",
	name: "Yarn Workspace",
	version: "0.1.0",
	category: "packageManager",
	exclusive: true,
	targetMode: "single",
	when: (config) => config.packageManager === "Yarn",
	contribute: () => [
		leafTextFile(projectTarget(), ".yarnrc.yml", "nodeLinker: node-modules\n"),
		surfaceLines(
			projectTarget(),
			"gitignore",
			[
				".pnp.*",
				".yarn/*",
				"!.yarn/patches",
				"!.yarn/plugins",
				"!.yarn/releases",
				"!.yarn/sdks",
				"!.yarn/versions",
			],
			{ section: "Yarn" },
		),
	],
});

export const yarnMetadata = {
	description:
		"Configures Yarn workspace behavior with the node-modules linker for managed Forge projects.",
	experimental: false,
	hidden: false,
	id: "yarn",
	keywords: ["package manager", "workspace", "yarn"],
	kind: "addon",
	name: "Yarn Workspace",
	summary: "Set up Yarn workspace support.",
} as const satisfies FirstPartyAddonMetadata;

export default yarn;
