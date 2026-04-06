import type { FileOperation } from "@ryuujs/core";
import { defineGenerator, filePath } from "@ryuujs/core";
import { Effect } from "effect";
import type { ForgeConfig } from "../config";
import { deps } from "../deps";
import { templateFiles } from "../template";

export default defineGenerator<ForgeConfig>({
	id: "ui",
	name: "UI Package",
	version: "0.1.0",
	category: "ui",
	exclusive: true,
	dependencies: ["tooling/typescript"],

	appliesTo: (config) => !!config.web,

	generate: (config) => Effect.succeed(buildOperations(config)),
});

function buildOperations(config: ForgeConfig): ReadonlyArray<FileOperation> {
	const slug = config.slug ?? "my-app";
	const templates = templateFiles("ui", "packages/ui");

	return [
		{
			_tag: "CreateJson",
			path: filePath("packages/ui/package.json"),
			value: {
				name: `@${slug}/ui`,
				version: "0.1.0",
				private: true,
				type: "module",
				exports: {
					"./globals.css": "./src/styles/globals.css",
					"./theme.css": "./src/styles/theme.css",
					"./postcss.config": "./postcss.config.mjs",
					"./lib/*": "./src/lib/*.ts",
					"./components/*": "./src/components/*.tsx",
					"./hooks/*": "./src/hooks/*.ts",
				},
			},
		},
		{
			_tag: "CreateJson",
			path: filePath("packages/ui/tsconfig.json"),
			value: {
				extends: "../../tsconfig.json",
				compilerOptions: {
					jsx: "preserve",
					jsxImportSource: "react",
					paths: { [`@${slug}/ui/*`]: ["./src/*"] },
				},
				include: ["./src", "./*.ts"],
				exclude: ["node_modules"],
			},
		},
		...templates,
		{
			_tag: "AddDependencies",
			path: filePath("packages/ui/package.json"),
			dependencies: [{ ...deps.clsx, type: "dependencies" }],
		},
	];
}
