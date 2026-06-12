import { defineAddon, projectTarget, surfaceJson } from "@ryuujs/core";
import type { ForgeConfig } from "../config";
import { resolveDatabaseProvider } from "../data/providers";
import type { FirstPartyAddonMetadata } from "../registry/types";

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
	const names = ["esbuild", "lefthook", "msw", "sharp"];

	if (config.orm === "prisma") {
		names.push("@prisma/engines", "prisma");

		if (
			resolveDatabaseProvider(config).prisma.clientTemplate === "better-sqlite3"
		)
			names.push("better-sqlite3");
	}

	return names.sort((left, right) => left.localeCompare(right));
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
