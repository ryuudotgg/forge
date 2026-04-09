import { defineAddon, dependencies, filePath, jsonFile } from "@ryuujs/core";
import type { ForgeConfig } from "../config";
import { deps } from "../deps";

const biome = defineAddon<ForgeConfig, "biome", "nextjs">({
	id: "biome",
	name: "Biome",
	version: "0.1.0",
	category: "linter",
	exclusive: true,
	targetMode: "single",
	when: (config) => config.linter === "biome",
	contribute: ({ config }) => {
		const excludes = ["**/dist", "**/.turbo", "**/.cache"];

		if (config.web === "nextjs") excludes.push("**/.next");
		if (config.mobile === "expo") excludes.push("**/.expo");

		return [
			jsonFile(filePath("biome.jsonc"), {
				$schema: "./node_modules/@biomejs/biome/configuration_schema.json",
				files: {
					includes: ["**/*", ...excludes.map((entry) => `!${entry}`)],
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
			}),
			dependencies(filePath("package.json"), [
				{ ...deps.biome, type: "devDependencies" },
			]),
		];
	},
});

export default biome;
