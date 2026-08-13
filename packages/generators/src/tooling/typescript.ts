import {
	defineAddon,
	formatJson,
	leafTextFile,
	projectTarget,
	surfaceJson,
} from "@ryuujs/core";
import type { ForgeConfig } from "../config";
import {
	frameworksInPlay,
	frameworkTsconfigPresets,
} from "../registry/frameworks-in-play";
import type { FirstPartyAddonMetadata } from "../registry/types";

const typescript = defineAddon<ForgeConfig, "typescript">({
	id: "typescript",
	name: "TypeScript",
	version: "0.1.0",
	category: "tooling",
	exclusive: false,
	targetMode: "single",
	when: () => true,
	contribute: ({ config, frameworks }) => {
		const slug = config.slug ?? "my-app";
		const presets = frameworkTsconfigPresets(
			frameworksInPlay(config, frameworks),
		);

		const baseTsconfig = {
			$schema: "https://json.schemastore.org/tsconfig",
			display: "Default",
			compilerOptions: {
				declaration: true,
				declarationMap: true,
				esModuleInterop: true,
				incremental: false,
				isolatedModules: true,
				lib: ["ESNext", "DOM", "DOM.Iterable"],
				module: "ESNext",
				moduleDetection: "force",
				moduleResolution: "Bundler",
				noUncheckedIndexedAccess: true,
				resolveJsonModule: true,
				skipLibCheck: true,
				strict: true,
				target: "ESNext",
			},
		};

		const reactLibraryTsconfig = {
			$schema: "https://json.schemastore.org/tsconfig",
			display: "React Library",
			extends: "./base.json",
			compilerOptions: { jsx: "react-jsx" },
		};

		const toolingPackageJson = {
			name: `@${slug}/tsconfig`,
			private: true,
		};

		return [
			surfaceJson(projectTarget(), "rootTsconfig", {
				extends: `@${slug}/tsconfig/base.json`,
			}),
			leafTextFile(
				projectTarget(),
				"tooling/tsconfig/package.json",
				formatJson(toolingPackageJson, { compact: false }),
			),
			leafTextFile(
				projectTarget(),
				"tooling/tsconfig/base.json",
				formatJson(baseTsconfig, { compact: true }),
			),
			...presets.map((preset) =>
				leafTextFile(
					projectTarget(),
					`tooling/tsconfig/${preset.name}.json`,
					formatJson(preset.content, { compact: true }),
				),
			),
			leafTextFile(
				projectTarget(),
				"tooling/tsconfig/react-library.json",
				formatJson(reactLibraryTsconfig, { compact: true }),
			),
		];
	},
});

export const typescriptMetadata = {
	description:
		"Adds the standard TypeScript project scaffolding and managed tsconfig surfaces.",
	experimental: false,
	hidden: false,
	id: "typescript",
	keywords: ["ts", "tsconfig", "typescript"],
	kind: "addon",
	name: "TypeScript",
	summary: "Add TypeScript project support.",
} as const satisfies FirstPartyAddonMetadata;

export default typescript;
