import {
	defineAddon,
	projectTarget,
	surfaceDependencies,
	surfaceJson,
	surfaceScripts,
} from "@ryuugg/core";
import type { ForgeConfig } from "../config";
import { deps } from "../deps";
import { pmExec } from "../pm";
import type { FirstPartyAddonMetadata } from "../registry/types";
import { houseIgnores } from "./ignores";
import type { LinterTooling } from "./tooling";

export const oxcTooling: LinterTooling = {
	scripts: {
		check: "oxlint && oxfmt --check",
		"check:fix": "oxlint --fix && oxfmt",
	},
	preCommit: (pm) => [
		`${pmExec(pm, "oxlint")} --fix --no-error-on-unmatched-pattern {staged_files}`,
		`${pmExec(pm, "oxfmt")} --no-error-on-unmatched-pattern {staged_files}`,
	],
	editor: {
		extension: "oxc.oxc-vscode",
		formatter: "oxc.oxc-vscode",
		fixAllAction: "source.fixAll.oxc",
		proseOverrides: {},
	},
};

const oxc = defineAddon<ForgeConfig, "oxc">({
	id: "oxc",
	name: "Oxc",
	version: "0.1.0",
	category: "linter",
	exclusive: true,
	targetMode: "single",
	when: (config) => config.linter === "oxc",
	contribute: () => [
		surfaceJson(projectTarget(), "oxlintConfig", {
			$schema: "./node_modules/oxlint/configuration_schema.json",
			plugins: ["typescript", "unicorn", "oxc", "import", "react"],
			categories: { correctness: "error" },
			rules: {
				"no-unused-vars": [
					"warn",
					{ argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
				],
				"typescript/consistent-type-imports": "warn",
				"unicorn/prefer-node-protocol": "warn",
			},
			ignorePatterns: [...houseIgnores],
		}),
		surfaceJson(projectTarget(), "oxfmtConfig", {
			$schema: "./node_modules/oxfmt/configuration_schema.json",
			printWidth: 80,
			tabWidth: 2,
			useTabs: false,
			endOfLine: "lf",
			singleQuote: false,
			semi: true,
			trailingComma: "all",
			sortImports: {
				newlinesBetween: false,
				partitionByNewline: true,
				groups: [
					"builtin",
					"external",
					["internal", "subpath"],
					["parent", "sibling", "index"],
					"unknown",
				],
			},
			sortPackageJson: false,
			ignorePatterns: [...houseIgnores],
		}),
		surfaceDependencies(projectTarget(), "rootPackageJson", [
			{ ...deps.oxlint, type: "devDependencies" },
			{ ...deps.oxfmt, type: "devDependencies" },
		]),
		surfaceScripts(projectTarget(), "rootPackageJson", oxcTooling.scripts),
	],
});

export const oxcMetadata = {
	description:
		"Adds Oxc formatting and linting configuration to the managed project surfaces.",
	experimental: false,
	hidden: false,
	id: "oxc",
	keywords: ["oxc", "formatting", "linting"],
	kind: "addon",
	name: "Oxc",
	summary: "Add Oxc formatting and linting.",
} as const satisfies FirstPartyAddonMetadata;

export default oxc;
