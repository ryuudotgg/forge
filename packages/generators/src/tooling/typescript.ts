import {
	defineAddon,
	formatJson,
	leafTextFile,
	projectTarget,
	surfaceJson,
} from "@ryuujs/core";
import type { ForgeConfig } from "../config";
import type { FirstPartyAddonMetadata } from "../registry/types";

const typescript = defineAddon<ForgeConfig, "typescript">({
	id: "typescript",
	name: "TypeScript",
	version: "0.1.0",
	category: "tooling",
	exclusive: false,
	targetMode: "single",
	when: () => true,
	contribute: ({ config }) => {
		const slug = config.slug ?? "my-app";

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

		const nextjsTsconfig = {
			$schema: "https://json.schemastore.org/tsconfig",
			display: "Next.js",
			extends: "./base.json",
			compilerOptions: {
				declaration: false,
				declarationMap: false,
				plugins: [{ name: "next" }],
				module: "ESNext",
				moduleResolution: "Bundler",
				allowJs: true,
				jsx: "preserve",
				noEmit: true,
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
			leafTextFile(
				projectTarget(),
				"tooling/tsconfig/nextjs.json",
				formatJson(nextjsTsconfig, { compact: true }),
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
