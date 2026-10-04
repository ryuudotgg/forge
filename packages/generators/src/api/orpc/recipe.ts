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
	variantAsset,
} from "@ryuugg/core";
import { selfHostedCorsRoute } from "../../client-cors";
import type { ForgeConfig } from "../../config";
import { deps } from "../../deps";
import { expressFramework } from "../../frameworks/express";
import { fastifyFramework } from "../../frameworks/fastify";
import { honoFramework } from "../../frameworks/hono";
import { nextjsFramework } from "../../frameworks/nextjs";
import { reactRouterFramework } from "../../frameworks/react-router";
import { tanstackRouterFramework } from "../../frameworks/tanstack-router";
import { tanstackStartFramework } from "../../frameworks/tanstack-start";
import { hasSecondaryClients } from "../../origins";
import { deriveRecipeAdapters } from "../../registry/recipe-adapters";
import { interpolate, readTemplate } from "../../template";
import { webAppInstances } from "../../web-apps";
import { orpcTemplateVars, renderOrpcTemplate } from "./shared";

export const orpcWebRecipe = defineTemplateRecipe({
	addon: "orpc",
	markers: {
		SLUG: marker.required,
		ENV_IMPORT: marker.required,
		SERVER_URL: marker.required,
		CLIENT_DIRECTIVE: marker.toggleLine("__CLIENT_DIRECTIVE__\n"),
	},
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

const orpcWebFrameworks = [
	nextjsFramework,
	reactRouterFramework,
	tanstackRouterFramework,
	tanstackStartFramework,
];

function orpcWebFramework(config: ForgeConfig) {
	return orpcWebFrameworks.find((framework) => framework.id === config.web);
}

export const orpcStandaloneRecipe = defineTemplateRecipe({
	addon: "orpc",
	markers: {
		SLUG: marker.required,
		AUTH_IMPORT: marker.toggleLine("__AUTH_IMPORT__;\n"),
		AUTH_ARG: marker.toggleInline("__AUTH_ARG__, "),
		WEB_ORIGINS: marker.required,
	},
	assets: [
		slotAsset("orpc", {
			variants: {
				hono: "api/orpc/routes/hono/orpc.ts",
				express: "api/orpc/routes/express/orpc.ts",
				fastify: "api/orpc/routes/fastify/orpc.ts",
			},
		}),
	],
});

export const orpcRequestRecipe = defineTemplateRecipe({
	addon: "orpc",
	markers: {
		SLUG: marker.required,
		AUTH_IMPORT: marker.toggleLine("__AUTH_IMPORT__;\n"),
		AUTH_ARG: marker.toggleInline("__AUTH_ARG__, "),
	},
	assets: [
		sharedAsset("server", {
			template: "api/orpc/request/server.ts",
			destination: inSourceRoot("orpc/server.ts"),
		}),
		slotAsset("orpc", {
			variants: {
				"react-router": "api/orpc/routes/react-router/api.orpc.$.ts",
				"tanstack-start": "api/orpc/routes/tanstack-start/$.ts",
			},
		}),
	],
});

export const orpcNextjsRecipe = defineTemplateRecipe({
	addon: "orpc",
	markers: {
		SLUG: marker.required,
		AUTH_IMPORT: marker.toggleLine("__AUTH_IMPORT__;\n"),
		AUTH_ARG: marker.toggleInline("__AUTH_ARG__, "),
	},
	assets: [
		variantAsset("health", {
			variants: { nextjs: "api/orpc/rsc/health.tsx" },
			destination: inSourceRoot("orpc/health.tsx"),
		}),
		slotAsset("orpc", {
			variants: { nextjs: "api/orpc/routes/nextjs/route.ts" },
		}),
	],
});

export const orpcNextjsAdapters = deriveRecipeAdapters({
	recipe: orpcNextjsRecipe,
	frameworks: [nextjsFramework],
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
	before: ({ config, module }) =>
		["client.ts", "server.ts", "react.tsx"].map((name) =>
			leafTextFile(
				moduleTarget(module),
				`orpc/${name}`,
				renderOrpcTemplate(config, `rsc/${name}`),
			),
		),
	after: ({ config, module }) => [
		leafTextFile(
			moduleTarget(module),
			"app/orpc-example/page.tsx",
			interpolate(readTemplate("api/orpc/rsc/page.tsx"), {
				PROJECT_NAME: config.name ?? config.slug ?? "my-app",
			}),
		),
		surfaceDependencies(moduleTarget(module), "packageJson", [
			{
				name: `@${config.slug ?? "my-app"}/orpc`,
				version: "workspace:*",
				type: "dependencies",
			},
			{ ...deps.orpcClient, type: "dependencies" },
			{ ...deps.orpcServer, type: "dependencies" },
			{ ...deps.orpcTanstackQuery, type: "dependencies" },
			{ ...deps.tanstackReactQuery, type: "dependencies" },
			{ ...deps.serverOnly, type: "dependencies" },
		]),
		...secondaryOrpcClients(config),
		...secondaryOrpcDependencies(config),
	],
});

export const orpcRequestAdapters = deriveRecipeAdapters({
	recipe: orpcRequestRecipe,
	frameworks: [reactRouterFramework, tanstackStartFramework],
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
	content: (asset, content, { config, framework }) =>
		asset._tag === "SlotAssetDefinition"
			? selfHostedCorsRoute(config, framework.id, content)
			: content,
	before: ({ config, framework, module }) =>
		orpcWebRecipe.assets.map((asset) => {
			const rendered = renderRecipeAsset(orpcWebRecipe, asset, framework, {
				markers: {
					SLUG: config.slug ?? "my-app",
					ENV_IMPORT: "../../env",
					SERVER_URL: "VITE_SERVER_URL",
					CLIENT_DIRECTIVE: "",
				},
				readTemplate,
				slots: {},
			});

			return leafTextFile(
				moduleTarget(module),
				rendered.destination,
				asset.name === "client"
					? renderOrpcTemplate(config, "request/client.ts")
					: rendered.content,
			);
		}),
	after: ({ config, module }) => [
		surfaceDependencies(moduleTarget(module), "packageJson", [
			{
				name: `@${config.slug ?? "my-app"}/orpc`,
				version: "workspace:*",
				type: "dependencies",
			},
			{ ...deps.orpcClient, type: "dependencies" },
			{ ...deps.orpcServer, type: "dependencies" },
			{ ...deps.orpcTanstackQuery, type: "dependencies" },
			{ ...deps.tanstackReactQuery, type: "dependencies" },
		]),
		...secondaryOrpcClients(config),
		...secondaryOrpcDependencies(config),
	],
});

export const orpcStandaloneAdapters = deriveRecipeAdapters({
	recipe: orpcStandaloneRecipe,
	frameworks: [honoFramework, expressFramework, fastifyFramework],
	readTemplate,
	requiredSlots: ["orpc"],
	markers: ({ config }: AdapterContext<ForgeConfig>) => {
		const values = orpcTemplateVars(config);
		return {
			SLUG: values.SLUG,
			AUTH_IMPORT: values["__AUTH_IMPORT__;\n"],
			AUTH_ARG: values["__AUTH_ARG__, "],
			WEB_ORIGINS: hasSecondaryClients(config)
				? "[env.WEB_URL, ...env.WEB_URLS]"
				: "env.WEB_URL",
		};
	},
	target: (_asset, context) => moduleTarget(context.module),
	before: ({ config }) => {
		const framework = orpcWebFramework(config);
		if (framework === undefined) return secondaryOrpcClients(config);

		return [
			...orpcWebRecipe.assets.map((asset) => {
				const rendered = renderRecipeAsset(orpcWebRecipe, asset, framework, {
					markers: {
						SLUG: config.slug ?? "my-app",
						ENV_IMPORT: framework.id === "nextjs" ? "../env" : "../../env",
						SERVER_URL: `${framework.clientEnvPrefix ?? "VITE_"}SERVER_URL`,
						CLIENT_DIRECTIVE:
							framework.id === "nextjs" ? '"use client";\n\n' : "",
					},
					readTemplate,
					slots: {},
				});

				return leafTextFile(
					ensuredModuleTarget("web"),
					rendered.destination,
					rendered.content,
				);
			}),
			...secondaryOrpcClients(config),
		];
	},
	after: ({ config, module }) => {
		const slug = config.slug ?? "my-app";
		return [
			surfaceDependencies(moduleTarget(module), "packageJson", [
				{ name: `@${slug}/orpc`, version: "workspace:*", type: "dependencies" },
				{ ...deps.orpcServer, type: "dependencies" },
			]),
			...(orpcWebFramework(config) !== undefined
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
			...secondaryOrpcDependencies(config),
		];
	},
});

function secondaryOrpcClients(config: ForgeConfig) {
	return webAppInstances(config)
		.filter((instance) => instance.client === true)
		.flatMap((instance) => {
			const framework = orpcWebFrameworks.find(
				(entry) => entry.id === instance.framework,
			);

			if (framework === undefined) return [];

			return orpcWebRecipe.assets.map((asset) => {
				const rendered = renderRecipeAsset(orpcWebRecipe, asset, framework, {
					markers: {
						SLUG: config.slug ?? "my-app",
						ENV_IMPORT: framework.id === "nextjs" ? "../env" : "../../env",
						SERVER_URL: `${framework.clientEnvPrefix ?? "VITE_"}SERVER_URL`,
						CLIENT_DIRECTIVE:
							framework.id === "nextjs" ? '"use client";\n\n' : "",
					},
					readTemplate,
					slots: {},
				});

				return leafTextFile(
					ensuredModuleTarget(instance.key),
					rendered.destination,
					rendered.content,
				);
			});
		});
}

function secondaryOrpcDependencies(config: ForgeConfig) {
	const slug = config.slug ?? "my-app";
	return webAppInstances(config)
		.filter((instance) => instance.client === true)
		.map((instance) =>
			surfaceDependencies(ensuredModuleTarget(instance.key), "packageJson", [
				{ name: `@${slug}/orpc`, version: "workspace:*", type: "dependencies" },
				{ ...deps.orpcClient, type: "dependencies" },
				{ ...deps.orpcServer, type: "dependencies" },
				{ ...deps.orpcTanstackQuery, type: "dependencies" },
				{ ...deps.tanstackReactQuery, type: "dependencies" },
			]),
		);
}
