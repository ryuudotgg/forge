import { defineAddon, dependencies, filePath, jsonFile } from "@ryuujs/core";
import type { ForgeConfig } from "../config";
import { deps } from "../deps";
import { templateFiles } from "../template";

const ui = defineAddon<ForgeConfig, "ui", "nextjs">({
	id: "ui",
	name: "UI Package",
	version: "0.1.0",
	category: "ui",
	exclusive: true,
	dependencies: [{ id: "typescript", type: "addon" }],
	targetMode: "single",
	compatibility: {
		app: {
			frameworks: ["nextjs"],
			requiredSlots: ["layout"],
		},
	},
	when: (config) => !!config.web,
	contribute: ({ config }) => {
		const slug = config.slug ?? "my-app";

		return [
			jsonFile(filePath("packages/ui/package.json"), {
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
			}),
			jsonFile(filePath("packages/ui/tsconfig.json"), {
				extends: "../../tsconfig.json",
				compilerOptions: {
					jsx: "preserve",
					jsxImportSource: "react",
					paths: { [`@${slug}/ui/*`]: ["./src/*"] },
				},
				include: ["./src", "./*.ts"],
				exclude: ["node_modules"],
			}),
			...templateFiles("ui", "packages/ui"),
			dependencies(filePath("packages/ui/package.json"), [
				{ ...deps.clsx, type: "dependencies" },
			]),
		];
	},
});

export default ui;
