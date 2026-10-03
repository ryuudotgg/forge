import type { AdapterContext } from "@ryuugg/core";
import {
	defineTemplateRecipe,
	ensuredModuleTarget,
	inSourceRoot,
	leafTextFile,
	marker,
	moduleTarget,
	renderRecipeAsset,
	sharedAsset,
	slotAsset,
	surfaceDependencies,
} from "@ryuugg/core";
import type { ForgeConfig } from "../../config";
import { deps } from "../../deps";
import { honoFramework } from "../../frameworks/hono";
import { tanstackRouterFramework } from "../../frameworks/tanstack-router";
import { deriveRecipeAdapters } from "../../registry/recipe-adapters";
import { readTemplate } from "../../template";
import { orpcTemplateVars } from "./shared";

export const orpcWebRecipe = defineTemplateRecipe({
	addon: "orpc",
	markers: { SLUG: marker.required },
	assets: [
		sharedAsset("client", {
			template: "api/orpc/web/client.ts",
			destination: inSourceRoot("orpc/client.ts"),
		}),
		sharedAsset("react", {
			template: "api/orpc/web/react.tsx",
			destination: inSourceRoot("orpc/react.tsx"),
		}),
	],
});

export const orpcHonoRecipe = defineTemplateRecipe({
	addon: "orpc",
	markers: {
		SLUG: marker.required,
		AUTH_IMPORT: marker.toggleLine("__AUTH_IMPORT__;\n"),
		AUTH_ARG: marker.toggleInline("__AUTH_ARG__, "),
	},
	assets: [
		slotAsset("orpc", { variants: { hono: "api/orpc/routes/hono/orpc.ts" } }),
	],
});

export const orpcHonoAdapters = deriveRecipeAdapters({
	recipe: orpcHonoRecipe,
	frameworks: [honoFramework],
	readTemplate,
	requiredSlots: ["orpc"],
	markers: ({ config }: AdapterContext<ForgeConfig>) => {
		const values = orpcTemplateVars(config);
		return {
			SLUG: values.SLUG,
			AUTH_IMPORT: values["__AUTH_IMPORT__;\n"],
			AUTH_ARG: values["__AUTH_ARG__, "],
		};
	},
	target: (_asset, context) => moduleTarget(context.module),
	before: ({ config }) => {
		if (config.web !== "tanstack-router") return [];

		return orpcWebRecipe.assets.map((asset) => {
			const rendered = renderRecipeAsset(
				orpcWebRecipe,
				asset,
				tanstackRouterFramework,
				{
					markers: { SLUG: config.slug ?? "my-app" },
					readTemplate,
					slots: {},
				},
			);

			return leafTextFile(
				ensuredModuleTarget("web"),
				rendered.destination,
				rendered.content,
			);
		});
	},
	after: ({ config, module }) => {
		const slug = config.slug ?? "my-app";
		return [
			surfaceDependencies(moduleTarget(module), "packageJson", [
				{ name: `@${slug}/orpc`, version: "workspace:*", type: "dependencies" },
				{ ...deps.orpcServer, type: "dependencies" },
			]),
			...(config.web === "tanstack-router"
				? [
						surfaceDependencies(ensuredModuleTarget("web"), "packageJson", [
							{
								name: `@${slug}/orpc`,
								version: "workspace:*",
								type: "dependencies",
							},
							{ ...deps.orpcClient, type: "dependencies" },
							{ ...deps.orpcServer, type: "dependencies" },
							{ ...deps.orpcTanstackQuery, type: "dependencies" },
							{ ...deps.tanstackReactQuery, type: "dependencies" },
						]),
					]
				: []),
		];
	},
});
