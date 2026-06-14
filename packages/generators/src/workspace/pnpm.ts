import { defineAddon, leafTextFile, projectTarget } from "@ryuujs/core";
import type { ForgeConfig } from "../config";
import type { FirstPartyAddonMetadata } from "../registry/types";
import { catalogEntries } from "../versions";
import { trustedBuildDependencies } from "./trusted-builds";

const pnpm = defineAddon<ForgeConfig, "pnpm">({
	id: "pnpm",
	name: "pnpm Workspace",
	version: "0.1.0",
	category: "packageManager",
	exclusive: true,
	targetMode: "single",
	when: (config) =>
		config.packageManager === "pnpm" || config.packageManager === undefined,
	contribute: ({ config }) => [
		leafTextFile(
			projectTarget(),
			"pnpm-workspace.yaml",
			buildWorkspaceYaml(config),
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

function quote(name: string): string {
	return /^[A-Za-z0-9._-]+$/.test(name) ? name : `"${name}"`;
}

function buildWorkspaceYaml(config: ForgeConfig): string {
	const lines: string[] = [
		"packages:",
		'  - "apps/*"',
		'  - "packages/*"',
		'  - "tooling/*"',
		"",
		"catalog:",
	];

	const groups = catalogEntries(config);
	const first = groups[0];
	for (const { group, entries } of groups) {
		if (group !== first?.group) lines.push("");
		lines.push(`  # ${group}`);
		for (const entry of entries)
			lines.push(`  ${quote(entry.name)}: ${entry.version}`);
	}

	lines.push("");
	lines.push("allowBuilds:");

	for (const name of trustedBuildDependencies(config).sort((left, right) =>
		left.localeCompare(right),
	))
		lines.push(`  ${quote(name)}: true`);

	lines.push("");

	return lines.join("\n");
}

export default pnpm;
