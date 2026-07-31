import {
	defineAdapter,
	ensuredModuleTarget,
	ensurePackageModule,
	leafTextFile,
	moduleTarget,
	surfaceDependencies,
	surfaceJson,
} from "@ryuujs/core";
import type { ForgeConfig } from "../../config";
import { deps } from "../../deps";
import { renderUiTemplate, uiComponentsJson } from "../shared";

export const uiNextjsAdapter = defineAdapter<ForgeConfig>({
	addon: "ui",
	framework: "nextjs",
	contribute: (context) => {
		const slug = context.config.slug ?? "my-app";
		const useTailwind = context.config.style === "tailwind";
		const target = moduleTarget(context.module);
		const webTailwindDeps: Array<{
			name: string;
			version: string;
			catalog?: string;
			type: "devDependencies";
		}> = [];

		if (useTailwind) {
			webTailwindDeps.push({
				...deps.tailwindcss,
				type: "devDependencies",
			});

			webTailwindDeps.push({
				...deps.tailwindPostcss,
				type: "devDependencies",
			});
		}

		return [
			ensurePackageModule("ui", "packages/ui", {
				packageType: "library",
				template: { id: "ui", version: 1 },
				capabilities: ["react", "ui", useTailwind ? "tailwind" : "css"],
				slots: {
					globalsCss: "src/styles/globals.css",
					utils: "src/lib/utils.ts",
					postcssConfig: "postcss.config.mjs",
				},
			}),
			surfaceJson(
				ensuredModuleTarget("ui"),
				"packageJson",
				{
					exports: {
						"./postcss.config": "./postcss.config.mjs",
					},
				},
				{ priority: 1 },
			),
			...(useTailwind
				? [
						surfaceDependencies(ensuredModuleTarget("ui"), "packageJson", [
							{ ...deps.tailwindPostcss, type: "devDependencies" },
						]),
					]
				: []),
			...(webTailwindDeps.length > 0
				? [surfaceDependencies(target, "packageJson", webTailwindDeps)]
				: []),
			leafTextFile(
				ensuredModuleTarget("ui"),
				"postcss.config.mjs",
				renderUiTemplate(context.config, "packages/ui/postcss.config.mjs"),
			),
			leafTextFile(
				ensuredModuleTarget("ui"),
				"components.json",
				`${JSON.stringify(uiComponentsJson(context.config, true), null, 2)}\n`,
			),
			leafTextFile(
				target,
				"components.json",
				renderUiTemplate(context.config, "nextjs/apps/web/components.json"),
			),
			leafTextFile(
				target,
				"postcss.config.mjs",
				`export { default } from "@${slug}/ui/postcss.config";\n`,
			),
		];
	},
});
