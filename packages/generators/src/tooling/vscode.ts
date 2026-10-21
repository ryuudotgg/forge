import { defineAddon, leafTextFile, projectTarget } from "@ryuugg/core";
import { type ForgeConfig, hasAddon } from "../config";
import { toolingFor } from "../linters/tooling";
import type { FirstPartyAddonMetadata } from "../registry/types";
import { interpolate, readTemplate } from "../template";

const vscode = defineAddon<ForgeConfig, "vscode">({
	id: "vscode",
	name: "VS Code",
	version: "0.1.0",
	category: "tooling",
	exclusive: false,
	targetMode: "single",
	when: (config) => hasAddon(config, "vscode"),
	contribute: ({ config }) => {
		const editor = toolingFor(config)?.editor;
		const editorSettings = editor
			? [
					`  "editor.defaultFormatter": "${editor.formatter}",`,
					...Object.entries(editor.proseOverrides).map(
						([language, formatter]) =>
							`  "[${language}]": { "editor.defaultFormatter": "${formatter}" },`,
					),
					"",
				].join("\n")
			: "";

		return [
			leafTextFile(
				projectTarget(),
				".vscode/settings.json",
				interpolate(readTemplate("tooling/vscode/settings.json"), {
					EDITOR_SETTINGS: editorSettings,
					FIX_ALL_SETTING: editor
						? `  "editor.codeActionsOnSave": { "${editor.fixAllAction}": "explicit" },\n`
						: "",
				}),
			),
			leafTextFile(
				projectTarget(),
				".vscode/extensions.json",
				interpolate(readTemplate("tooling/vscode/extensions.json"), {
					LINTER_EXTENSION: editor ? `    "${editor.extension}",\n` : "",
				}),
			),
		];
	},
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
