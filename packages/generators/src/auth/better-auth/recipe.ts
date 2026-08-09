import type { AdapterContext } from "@ryuujs/core";
import {
	defineTemplateRecipe,
	ensuredModuleTarget,
	inModule,
	marker,
	moduleTarget,
	sharedAsset,
	slotAsset,
	slotPath,
	surfaceDependencies,
} from "@ryuujs/core";
import type { ForgeConfig } from "../../config";
import { deps } from "../../deps";
import { nextjsFramework } from "../../frameworks/nextjs";
import { reactRouterFramework } from "../../frameworks/react-router";
import { tanstackStartFramework } from "../../frameworks/tanstack-start";
import { deriveRecipeAdapters } from "../../registry/recipe-adapters";
import { readTemplate } from "../../template";
import { betterAuthRecipeVars } from "./shared";

export const betterAuthRecipe = defineTemplateRecipe({
	addon: "better-auth",
	markers: {
		SLUG: marker.required,
		DATASOURCE_PROVIDER: marker.required,
		DRIZZLE_PROVIDER: marker.required,
		COOKIE_IMPORT: marker.toggleLine("// __COOKIE_IMPORT__\n"),
		COOKIE_PLUGIN: marker.toggleLine("  // __COOKIE_PLUGIN__\n\n"),
	},
	assets: [
		sharedAsset("index-drizzle", {
			template: "auth/better-auth/packages/auth/src/index.drizzle.ts",
			destination: inModule("src/index.drizzle.ts"),
		}),
		sharedAsset("index-prisma", {
			template: "auth/better-auth/packages/auth/src/index.prisma.ts",
			destination: inModule("src/index.prisma.ts"),
		}),
		slotAsset("auth", {
			variants: {
				nextjs: "auth/better-auth/routes/nextjs/route.ts",
				"react-router": "auth/better-auth/routes/react-router/api.auth.$.ts",
				"tanstack-start": "auth/better-auth/routes/tanstack-start/$.ts",
			},
		}),
	],
});

export const betterAuthAdapters = deriveRecipeAdapters({
	recipe: betterAuthRecipe,
	frameworks: [nextjsFramework, reactRouterFramework, tanstackStartFramework],
	readTemplate,
	requiredSlots: ["auth"],
	markers: (context: AdapterContext<ForgeConfig>) => {
		if (context.config.orm !== "drizzle" && context.config.orm !== "prisma")
			throw new Error(
				`Orm Required: better-auth adapter for ${context.framework.id}`,
			);

		return betterAuthRecipeVars(context.config, context.framework);
	},
	include: (asset, { config }) =>
		asset._tag === "SlotAssetDefinition" ||
		asset.name === `index-${config.orm}`,
	target: (asset, context) =>
		asset._tag === "SlotAssetDefinition"
			? moduleTarget(context.module)
			: ensuredModuleTarget("auth"),
	path: (asset, _rendered, context) =>
		asset._tag === "SlotAssetDefinition"
			? slotPath(moduleTarget(context.module), asset.slot)
			: "src/index.ts",
	after: ({ config, module }) => {
		const slug = config.slug ?? "my-app";

		return [
			surfaceDependencies(moduleTarget(module), "packageJson", [
				{
					name: `@${slug}/auth`,
					version: "workspace:*",
					type: "dependencies",
				},
				{ ...deps.betterAuth, type: "dependencies" },
			]),
		];
	},
});
