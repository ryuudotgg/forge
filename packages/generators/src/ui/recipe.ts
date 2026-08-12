import type { AdapterContext, Contribution } from "@ryuujs/core";
import {
	defineTemplateRecipe,
	ensuredModuleTarget,
	ensurePackageModule,
	inModule,
	leafTextFile,
	marker,
	moduleTarget,
	sharedAsset,
	surfaceDependencies,
	surfaceJson,
} from "@ryuujs/core";
import type { ForgeConfig } from "../config";
import { deps } from "../deps";
import { nextjsFramework } from "../frameworks/nextjs";
import { reactRouterFramework } from "../frameworks/react-router";
import { tanstackRouterFramework } from "../frameworks/tanstack-router";
import { tanstackStartFramework } from "../frameworks/tanstack-start";
import { deriveRecipeAdapters } from "../registry/recipe-adapters";
import { readTemplate } from "../template";
import { renderUiTemplate, uiComponentsJson, uiStyle } from "./shared";

export const uiRecipe = defineTemplateRecipe({
	addon: "ui",
	markers: {
		SHADCN_STYLE: marker.required,
		SLUG: marker.required,
		RSC: marker.required,
	},
	assets: [
		sharedAsset("components", {
			template: "ui/web/components.json",
			destination: inModule("components.json"),
		}),
	],
});

export const uiAdapters = deriveRecipeAdapters({
	recipe: uiRecipe,
	frameworks: [
		nextjsFramework,
		reactRouterFramework,
		tanstackRouterFramework,
		tanstackStartFramework,
	],
	readTemplate,
	markers: ({ config, framework }: AdapterContext<ForgeConfig>) => ({
		SHADCN_STYLE: uiStyle(config),
		SLUG: config.slug ?? "my-app",
		RSC: framework.id === "nextjs" ? "true" : "false",
	}),
	target: (_asset, context) => moduleTarget(context.module),
	before: (context) => {
		const useTailwind = context.config.style === "tailwind";
		const isNextjs = context.framework.id === "nextjs";
		const target = moduleTarget(context.module);
		const contributions: Array<Contribution> = [];
		const webTailwindDeps: Array<{
			name: string;
			version: string;
			catalog?: string;
			type: "devDependencies";
		}> = [];

		if (useTailwind) {
			webTailwindDeps.push({ ...deps.tailwindcss, type: "devDependencies" });
			webTailwindDeps.push({
				...(isNextjs ? deps.tailwindPostcss : deps.tailwindVite),
				type: "devDependencies",
			});
		}

		if (isNextjs) {
			contributions.push(
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
					{ exports: { "./postcss.config": "./postcss.config.mjs" } },
					{ priority: 1 },
				),
			);

			if (useTailwind)
				contributions.push(
					surfaceDependencies(ensuredModuleTarget("ui"), "packageJson", [
						{ ...deps.tailwindPostcss, type: "devDependencies" },
					]),
				);
		}

		if (webTailwindDeps.length > 0)
			contributions.push(
				surfaceDependencies(target, "packageJson", webTailwindDeps),
			);

		if (isNextjs)
			contributions.push(
				leafTextFile(
					ensuredModuleTarget("ui"),
					"postcss.config.mjs",
					renderUiTemplate(context.config, "packages/ui/postcss.config.mjs"),
				),
			);

		contributions.push(
			leafTextFile(
				ensuredModuleTarget("ui"),
				"components.json",
				`${JSON.stringify(uiComponentsJson(context.config, isNextjs), null, 2)}\n`,
			),
		);

		return contributions;
	},
	after: (context) =>
		context.framework.id === "nextjs"
			? [
					leafTextFile(
						moduleTarget(context.module),
						"postcss.config.mjs",
						`export { default } from "@${context.config.slug ?? "my-app"}/ui/postcss.config";\n`,
					),
				]
			: [],
});
