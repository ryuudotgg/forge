import { defineAddon, leafTextFile, projectTarget } from "@ryuujs/core";
import type { ForgeConfig } from "../config";
import type { FirstPartyAddonMetadata } from "../registry/types";
import { catalogEntries } from "../versions";

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

	if (config.orm === "prisma")
		lines.push(`  ${quote("@prisma/engines")}: true`);

	lines.push("  esbuild: true");
	lines.push("  lefthook: true");
	lines.push("  msw: true");

	if (config.orm === "prisma") lines.push("  prisma: true");

	lines.push("  sharp: true");
	lines.push("");

	return lines.join("\n");
}

export default pnpm;
