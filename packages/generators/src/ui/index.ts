import {
	defineAddon,
	ensuredModuleTarget,
	ensurePackageModule,
	surfaceDependencies,
	surfaceJson,
	surfaceText,
} from "@ryuujs/core";
import type { ForgeConfig } from "../config";
import { deps } from "../deps";
import { readTemplate } from "../template";

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
			ensurePackageModule("ui", "packages/ui", {
				packageType: "library",
				template: { id: "ui", version: 1 },
				capabilities: ["react", "ui"],
				slots: {
					globalsCss: "src/styles/globals.css",
					themeCss: "src/styles/theme.css",
					utils: "src/lib/utils.ts",
					postcssConfig: "postcss.config.mjs",
					client: "src/client.ts",
					provider: "src/provider.tsx",
				},
			}),
			surfaceJson(ensuredModuleTarget("ui"), "packageJson", {
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
			surfaceJson(ensuredModuleTarget("ui"), "tsconfig", {
				extends: "../../tsconfig.json",
				compilerOptions: {
					jsx: "preserve",
					jsxImportSource: "react",
					paths: { [`@${slug}/ui/*`]: ["./src/*"] },
				},
				include: ["./src", "./*.ts"],
				exclude: ["node_modules"],
			}),
			surfaceText(
				ensuredModuleTarget("ui"),
				"globalsCss",
				readTemplate("ui/src/styles/globals.css"),
				{ priority: 0 },
			),
			surfaceText(
				ensuredModuleTarget("ui"),
				"utils",
				readTemplate("ui/src/lib/utils.ts"),
				{ priority: 0 },
			),
			surfaceDependencies(ensuredModuleTarget("ui"), "packageJson", [
				{ ...deps.clsx, type: "dependencies" },
			]),
		];
	},
});

export default ui;
