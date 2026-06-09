import { defineAddon, leafTextFile, projectTarget } from "@ryuujs/core";
import type { ForgeConfig } from "../config";
import type { FirstPartyAddonMetadata } from "../registry/types";
import { readTemplate } from "../template";

const vscode = defineAddon<ForgeConfig, "vscode">({
	id: "vscode",
	name: "VS Code",
	version: "0.1.0",
	category: "tooling",
	exclusive: false,
	targetMode: "single",
	when: () => true,
	contribute: () => [
		leafTextFile(
			projectTarget(),
			".vscode/settings.json",
			readTemplate("tooling/vscode/settings.json"),
		),
		leafTextFile(
			projectTarget(),
			".vscode/extensions.json",
			readTemplate("tooling/vscode/extensions.json"),
		),
	],
});

export const vscodeMetadata = {
	description: "Adds .vscode/settings.json and extensions recommendations.",
	experimental: false,
	hidden: false,
	id: "vscode",
	keywords: ["editor", "tooling", "vscode"],
	kind: "addon",
	name: "VS Code",
	summary: "Configure VS Code workspace.",
} as const satisfies FirstPartyAddonMetadata;

export default vscode;
