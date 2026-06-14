import { defineAddon, projectTarget, surfaceJson } from "@ryuujs/core";
import type { ForgeConfig } from "../config";
import type { FirstPartyAddonMetadata } from "../registry/types";
import { trustedBuildDependencies } from "./trusted-builds";

const bun = defineAddon<ForgeConfig, "bun">({
	id: "bun",
	name: "Bun Workspace",
	version: "0.1.0",
	category: "packageManager",
	exclusive: true,
	targetMode: "single",
	when: (config) => config.packageManager === "Bun",
	contribute: ({ config }) => [
		surfaceJson(projectTarget(), "rootPackageJson", {
			trustedDependencies: trustedDependencies(config),
		}),
	],
});

function trustedDependencies(config: ForgeConfig): string[] {
	return trustedBuildDependencies(config).sort((left, right) =>
		left.localeCompare(right),
	);
}

export const bunMetadata = {
	description:
		"Configures Bun workspace behavior and trusts the build scripts managed Forge projects rely on.",
	experimental: false,
	hidden: false,
	id: "bun",
	keywords: ["bun", "package manager", "workspace"],
	kind: "addon",
	name: "Bun Workspace",
	summary: "Set up Bun workspace support.",
} as const satisfies FirstPartyAddonMetadata;

export default bun;
