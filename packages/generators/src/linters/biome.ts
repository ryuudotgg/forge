import {
	defineAddon,
	projectTarget,
	surfaceDependencies,
	surfaceJson,
	surfaceScripts,
} from "@ryuugg/core";
import type { ForgeConfig } from "../config";
import { deps } from "../deps";
import { pmRun } from "../pm";
import type { FirstPartyAddonMetadata } from "../registry/types";
import { houseIgnores } from "./ignores";
import type { LinterTooling } from "./tooling";

export const biomeTooling: LinterTooling = {
	scripts: { check: "biome check .", "check:fix": "biome check --write ." },
	preCommit: (pm) => [
		pmRun(pm, "check:fix", "--staged --no-errors-on-unmatched"),
	],
	editor: {
		extension: "biomejs.biome",
		formatter: "biomejs.biome",
		fixAllAction: "source.fixAll.biome",
		proseOverrides: {
			markdown: "esbenp.prettier-vscode",
			mdx: "esbenp.prettier-vscode",
			yaml: "esbenp.prettier-vscode",
		},
	},
};

const biome = defineAddon<ForgeConfig, "biome", "nextjs">({
	id: "biome",
	name: "Biome",
	version: "0.1.0",
	category: "linter",
	exclusive: true,
	importOrder: "scope",
	switching: {
		reformat: {
			bin: "biome",
			args: [
				"check",
				"--write",
				"--linter-enabled=false",
				"--files-ignore-unknown=true",
				"--no-errors-on-unmatched",
			],
		},
	},
	targetMode: "single",
	when: (config) => config.linter === "biome",
	contribute: () => [
		surfaceJson(projectTarget(), "biomeConfig", {
			$schema: "./node_modules/@biomejs/biome/configuration_schema.json",
			vcs: {
				enabled: true,
				clientKind: "git",
				useIgnoreFile: true,
				defaultBranch: "main",
			},
			assist: {
				enabled: true,
				actions: { source: { organizeImports: "on" } },
			},
			formatter: {
				enabled: true,
				indentStyle: "space",
				indentWidth: 2,
				lineWidth: 80,
				lineEnding: "lf",
			},
			javascript: {
				formatter: {
					quoteStyle: "double",
					trailingCommas: "all",
					semicolons: "always",
				},
			},
			linter: {
				enabled: true,
				rules: {
					preset: "recommended",
					correctness: { noUnusedImports: "warn" },
					style: {
						useImportType: "warn",
						useNodejsImportProtocol: "warn",
					},
				},
			},
			css: {
				parser: { tailwindDirectives: true },
				formatter: { enabled: true },
				linter: { enabled: true },
			},
			json: {
				parser: { allowComments: true, allowTrailingCommas: true },
			},
			files: {
				includes: ["**", ...houseIgnores.map((path) => `!**/${path}`)],
			},
		}),
		surfaceDependencies(projectTarget(), "rootPackageJson", [
			{ ...deps.biome, type: "devDependencies" },
		]),
		surfaceScripts(projectTarget(), "rootPackageJson", biomeTooling.scripts),
	],
});

export const biomeMetadata = {
	description:
		"Adds Biome formatting and linting configuration to the managed project surfaces.",
	experimental: false,
	hidden: false,
	id: "biome",
	keywords: ["biome", "formatting", "linting"],
	kind: "addon",
	name: "Biome",
	summary: "Add Biome formatting and linting.",
} as const satisfies FirstPartyAddonMetadata;

export default biome;
