import type { FileOperation } from "@ryuujs/core";
import { defineGenerator, filePath } from "@ryuujs/core";
import { Effect } from "effect";
import type { ForgeConfig } from "../config";
import { deps } from "../deps";

export default defineGenerator<ForgeConfig>({
	id: "linters/biome",
	name: "Biome",
	version: "0.1.0",
	category: "linter",
	exclusive: true,
	dependencies: [],

	appliesTo: (config) => config.linter === "Biome",

	generate: (config) => Effect.succeed(buildOperations(config)),
});

function buildOperations(config: ForgeConfig): ReadonlyArray<FileOperation> {
	const excludes = ["**/dist", "**/.turbo", "**/.cache"];

	if (config.web === "Next.js") excludes.push("**/.next");
	if (config.mobile === "Expo") excludes.push("**/.expo");

	return [
		{
			_tag: "CreateJson",
			path: filePath("biome.jsonc"),
			value: {
				$schema: "./node_modules/@biomejs/biome/configuration_schema.json",
				files: {
					includes: ["**/*", ...excludes.map((e) => `!${e}`)],
				},
				formatter: {
					enabled: true,
					indentStyle: "tab",
					lineEnding: "lf",
					lineWidth: 80,
				},
				linter: {
					enabled: true,
					rules: { recommended: true },
				},
				assist: {
					enabled: true,
					actions: {
						source: {
							organizeImports: "on",
						},
					},
				},
			},
		},
		{
			_tag: "AddDependencies",
			path: filePath("package.json"),
			dependencies: [{ ...deps.biome, type: "devDependencies" }],
		},
	];
}
