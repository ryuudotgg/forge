import type { AdapterContext } from "@ryuugg/core";
import {
	type Dependency,
	defineTemplateRecipe,
	ensuredModuleTarget,
	inModule,
	inSourceRoot,
	leafTextFile,
	marker,
	moduleTarget,
	renderRecipeAsset,
	sharedAsset,
	slotAsset,
	slotPath,
	surfaceDependencies,
} from "@ryuugg/core";
import { selfHostedCorsRoute } from "../../client-cors";
import type { ForgeConfig } from "../../config";
import { deps } from "../../deps";
import { expoFramework, expoScheme } from "../../frameworks/expo";
import { expressFramework } from "../../frameworks/express";
import { fastifyFramework } from "../../frameworks/fastify";
import { honoFramework } from "../../frameworks/hono";
import { nextjsFramework } from "../../frameworks/nextjs";
import { reactRouterFramework } from "../../frameworks/react-router";
import { tanstackStartFramework } from "../../frameworks/tanstack-start";
import { serverCorsMarkers } from "../../origins";
import { deriveRecipeAdapters } from "../../registry/recipe-adapters";
import { readTemplate } from "../../template";
import { catalogRef } from "../../versions";
import {
	authPluginBindings,
	authPluginImports,
	authPluginPackages,
} from "../plugins";
import { betterAuthRecipeVars } from "./shared";

const betterAuthMarkers = {
	SLUG: marker.required,
	APP_NAME: marker.required,
	AUTH_ENV_NAMES: marker.required,
	DATASOURCE_PROVIDER: marker.required,
	DRIZZLE_PROVIDER: marker.required,
	PLUGIN_IMPORTS: marker.toggleLine("// __PLUGIN_IMPORTS__\n"),
	SCOPED_PLUGIN_IMPORTS: marker.toggleLine("__SCOPED_PLUGIN_IMPORTS__\n"),
	RELATIVE_PLUGIN_IMPORTS: marker.toggleLine("__RELATIVE_PLUGIN_IMPORTS__\n"),
	PLUGINS: marker.toggleLine("  // __PLUGINS__\n\n"),
	CLIENT_PLUGIN_IMPORTS: marker.toggleLine("// __CLIENT_PLUGIN_IMPORTS__\n"),
	CLIENT_PLUGINS: marker.toggleLine("    // __CLIENT_PLUGINS__\n"),
	TRUSTED_ORIGINS: marker.toggleLine("  // __TRUSTED_ORIGINS__\n"),
	EMAIL_PASSWORD: marker.toggleLine("  // __EMAIL_PASSWORD__\n"),
	SOCIAL_DECLARATION: marker.toggleLine("// __SOCIAL_DECLARATION__\n"),
	SOCIAL_OPTION: marker.toggleLine("  // __SOCIAL_OPTION__\n\n"),
	SOCIAL_FUNCTION: marker.toggleLine("// __SOCIAL_FUNCTION__\n\n"),
	ADAPTER_SCHEMA_IMPORT: marker.toggleLine("__ADAPTER_SCHEMA_IMPORT__\n"),
	ADAPTER_MODELS: marker.toggleLine("__ADAPTER_MODELS__\n"),
} as const;

const { CLIENT_PLUGIN_IMPORTS, CLIENT_PLUGINS, ...betterAuthServerMarkers } =
	betterAuthMarkers;

function betterAuthModuleDependencies(config: ForgeConfig) {
	const slug = config.slug ?? "my-app";
	return [
		{
			name: `@${slug}/auth`,
			version: "workspace:*",
			type: "dependencies" as const,
		},
		{ ...catalogRef("betterAuth", config), type: "dependencies" as const },
	];
}

export const betterAuthRecipe = defineTemplateRecipe({
	addon: "better-auth",
	markers: betterAuthServerMarkers,
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
	content: (asset, content, { config, framework }) =>
		asset._tag === "SlotAssetDefinition"
			? selfHostedCorsRoute(config, framework.id, content)
			: content,
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
	after: ({ config, module }) => [
		surfaceDependencies(
			moduleTarget(module),
			"packageJson",
			betterAuthModuleDependencies(config),
		),
		...expoAuthClientContributions(config),
	],
});

// Recipes claim one destination per framework, so the shared assets need
// distinct keys here even though `path` below rewrites both to src/index.ts.
export const betterAuthHonoRecipe = defineTemplateRecipe({
	addon: "better-auth",
	markers: {
		...betterAuthServerMarkers,
		SERVER_ENV_BINDING: marker.required,
		WEB_ORIGINS: marker.required,
	},
	assets: [
		sharedAsset("index-drizzle", {
			template: "auth/better-auth/packages/auth/src/index.drizzle.ts",
			destination: inModule("src/hono-index.drizzle.ts"),
		}),
		sharedAsset("index-prisma", {
			template: "auth/better-auth/packages/auth/src/index.prisma.ts",
			destination: inModule("src/hono-index.prisma.ts"),
		}),
		slotAsset("auth", {
			variants: { hono: "auth/better-auth/routes/hono/auth.ts" },
		}),
	],
});

export const betterAuthHonoAdapters = deriveRecipeAdapters({
	recipe: betterAuthHonoRecipe,
	frameworks: [honoFramework],
	readTemplate,
	requiredSlots: ["auth"],
	markers: ({ config }: AdapterContext<ForgeConfig>) => ({
		...betterAuthRecipeVars(config, honoFramework),
		...serverCorsMarkers(config),
	}),
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
	after: ({ config, module }) => [
		surfaceDependencies(
			moduleTarget(module),
			"packageJson",
			betterAuthModuleDependencies(config),
		),
		...expoAuthClientContributions(config),
	],
});

export const betterAuthFastifyRecipe = defineTemplateRecipe({
	addon: "better-auth",
	markers: betterAuthServerMarkers,
	assets: [
		sharedAsset("fastify-index-drizzle", {
			template: "auth/better-auth/packages/auth/src/index.drizzle.ts",
			destination: inModule("src/fastify-index.drizzle.ts"),
		}),
		sharedAsset("fastify-index-prisma", {
			template: "auth/better-auth/packages/auth/src/index.prisma.ts",
			destination: inModule("src/fastify-index.prisma.ts"),
		}),
		slotAsset("auth", {
			variants: { fastify: "auth/better-auth/routes/fastify/auth.ts" },
		}),
	],
});

export const betterAuthFastifyAdapters = deriveRecipeAdapters({
	recipe: betterAuthFastifyRecipe,
	frameworks: [fastifyFramework],
	readTemplate,
	requiredSlots: ["auth"],
	markers: ({ config }: AdapterContext<ForgeConfig>) =>
		betterAuthRecipeVars(config, fastifyFramework),
	include: (asset, { config }) =>
		asset._tag === "SlotAssetDefinition" ||
		asset.name === `fastify-index-${config.orm}`,
	target: (asset, context) =>
		asset._tag === "SlotAssetDefinition"
			? moduleTarget(context.module)
			: ensuredModuleTarget("auth"),
	path: (asset, _rendered, context) =>
		asset._tag === "SlotAssetDefinition"
			? slotPath(moduleTarget(context.module), asset.slot)
			: "src/index.ts",
	after: ({ config, module }) => [
		surfaceDependencies(
			moduleTarget(module),
			"packageJson",
			betterAuthModuleDependencies(config),
		),
		...expoAuthClientContributions(config),
	],
});

export const betterAuthExpressRecipe = defineTemplateRecipe({
	addon: "better-auth",
	markers: betterAuthServerMarkers,
	assets: [
		sharedAsset("express-index-drizzle", {
			template: "auth/better-auth/packages/auth/src/index.drizzle.ts",
			destination: inModule("src/express-index.drizzle.ts"),
		}),
		sharedAsset("express-index-prisma", {
			template: "auth/better-auth/packages/auth/src/index.prisma.ts",
			destination: inModule("src/express-index.prisma.ts"),
		}),
		slotAsset("auth", {
			variants: { express: "auth/better-auth/routes/express/auth.ts" },
		}),
	],
});

export const betterAuthExpressAdapters = deriveRecipeAdapters({
	recipe: betterAuthExpressRecipe,
	frameworks: [expressFramework],
	readTemplate,
	requiredSlots: ["auth"],
	markers: ({ config }: AdapterContext<ForgeConfig>) =>
		betterAuthRecipeVars(config, expressFramework),
	include: (asset, { config }) =>
		asset._tag === "SlotAssetDefinition" ||
		asset.name === `express-index-${config.orm}`,
	target: (asset, context) =>
		asset._tag === "SlotAssetDefinition"
			? moduleTarget(context.module)
			: ensuredModuleTarget("auth"),
	path: (asset, _rendered, context) =>
		asset._tag === "SlotAssetDefinition"
			? slotPath(moduleTarget(context.module), asset.slot)
			: "src/index.ts",
	after: ({ config, module }) => [
		surfaceDependencies(
			moduleTarget(module),
			"packageJson",
			betterAuthModuleDependencies(config),
		),
		...expoAuthClientContributions(config),
	],
});

export const betterAuthExpoRecipe = defineTemplateRecipe({
	addon: "better-auth",
	markers: {
		SCHEME: marker.required,
		SLUG: marker.required,
		CLIENT_PLUGIN_IMPORTS,
		CLIENT_PLUGINS,
	},
	assets: [
		sharedAsset("expo-client", {
			template: "auth/better-auth/expo/auth-client.ts",
			destination: inSourceRoot("lib/auth-client.ts"),
		}),
	],
});

export function expoAuthClientContributions(config: ForgeConfig) {
	if (config.mobile !== "expo") return [];

	const slug = config.slug ?? "my-app";
	const plugins = authPluginBindings(config, "expo");
	const markers = {
		SCHEME: expoScheme(slug),
		SLUG: slug,
		CLIENT_PLUGIN_IMPORTS: authPluginImports(plugins),
		CLIENT_PLUGINS: plugins.map(({ name }) => `    ${name}(),\n`).join(""),
	};

	const asset = betterAuthExpoRecipe.assets[0];
	const rendered = renderRecipeAsset(
		betterAuthExpoRecipe,
		asset,
		expoFramework,
		{ markers, readTemplate, slots: {} },
	);

	const target = ensuredModuleTarget("mobile");
	return [
		leafTextFile(target, rendered.destination, rendered.content),
		surfaceDependencies(target, "packageJson", [
			{ ...catalogRef("betterAuth", config), type: "dependencies" },
			{ ...deps.betterAuthExpo, type: "dependencies" },
			...authPluginPackages(config, "expo").map(
				(dependency): Dependency => ({
					...dependency,
					type: "dependencies",
				}),
			),
			{ ...deps.expoSecureStore, type: "dependencies" },
		]),
	];
}
