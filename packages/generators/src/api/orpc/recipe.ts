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
import { nextjsFramework } from "../../frameworks/nextjs";
import { reactRouterFramework } from "../../frameworks/react-router";
import { tanstackRouterFramework } from "../../frameworks/tanstack-router";
import { tanstackStartFramework } from "../../frameworks/tanstack-start";
import { hasSecondaryClients } from "../../origins";
import { deriveRecipeAdapters } from "../../registry/recipe-adapters";
import { readTemplate } from "../../template";
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

export const orpcHonoRecipe = defineTemplateRecipe({
	addon: "orpc",
	markers: {
		SLUG: marker.required,
		AUTH_IMPORT: marker.toggleLine("__AUTH_IMPORT__;\n"),
		AUTH_ARG: marker.toggleInline("__AUTH_ARG__, "),
		WEB_ORIGINS: marker.required,
	},
	assets: [
		slotAsset("orpc", { variants: { hono: "api/orpc/routes/hono/orpc.ts" } }),
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
