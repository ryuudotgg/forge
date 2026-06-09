import {
	defineAddon,
	projectTarget,
	surfaceDependencies,
	surfaceJson,
} from "@ryuujs/core";
import type { ForgeConfig } from "../config";
import { deps } from "../deps";
import type { FirstPartyAddonMetadata } from "../registry/types";

const biome = defineAddon<ForgeConfig, "biome", "nextjs">({
	id: "biome",
	name: "Biome",
	version: "0.1.0",
	category: "linter",
	exclusive: true,
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
					recommended: true,
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
				includes: [
					"**",
					"!**/node_modules",
					"!**/.next",
					"!**/.turbo",
					"!**/.vercel",
					"!**/.expo",
					"!**/.cache",
					"!**/.forge",
					"!**/coverage",
					"!**/dist",
					"!**/build",
					"!**/out",
					"!**/.env",
					"!**/.env.*",
				],
			},
		}),
		surfaceDependencies(projectTarget(), "rootPackageJson", [
			{ ...deps.biome, type: "devDependencies" },
		]),
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
