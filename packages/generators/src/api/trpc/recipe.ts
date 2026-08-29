import type { AdapterContext } from "@ryuujs/core";
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
} from "@ryuujs/core";
import type { ForgeConfig } from "../../config";
import { deps } from "../../deps";
import { expoFramework } from "../../frameworks/expo";
import { fastifyFramework } from "../../frameworks/fastify";
import { honoFramework } from "../../frameworks/hono";
import { nextjsFramework } from "../../frameworks/nextjs";
import { reactRouterFramework } from "../../frameworks/react-router";
import { tanstackRouterFramework } from "../../frameworks/tanstack-router";
import { tanstackStartFramework } from "../../frameworks/tanstack-start";
import { deriveRecipeAdapters } from "../../registry/recipe-adapters";
import { readTemplate } from "../../template";
import {
	trpcRecipeMarkers,
	trpcTemplateVars,
	trpcWebDependencies,
} from "./shared";

export const trpcRecipe = defineTemplateRecipe({
	addon: "trpc",
	markers: {
		SLUG: marker.required,
		AUTH_IMPORT: marker.toggleLine("// __AUTH_IMPORT__\n"),
		AUTH_ARG: marker.toggleInline("/* __AUTH_ARG__ */ "),
		ENV_IMPORT: marker.toggleLine("// __ENV_IMPORT__\n"),
		API_URL: marker.required,
		CREDENTIAL_FETCH: marker.toggleLine("          // __CREDENTIAL_FETCH__\n"),
	},
	assets: [
		sharedAsset("query-client", {
			template: "api/trpc/web/query-client.ts",
			destination: inSourceRoot("trpc/query-client.ts"),
		}),
		variantAsset("server", {
			destination: inSourceRoot("trpc/server.ts"),
			variants: {
				nextjs: "api/trpc/rsc/server.ts",
				"react-router": "api/trpc/request/server.ts",
				"tanstack-router": "api/trpc/request/server.ts",
				"tanstack-start": "api/trpc/request/server.ts",
			},
		}),
		variantAsset("react", {
			destination: inSourceRoot("trpc/react.tsx"),
			variants: {
				nextjs: "api/trpc/rsc/react.tsx",
				"react-router": "api/trpc/vite/react.tsx",
				"tanstack-router": "api/trpc/vite/react.tsx",
				"tanstack-start": "api/trpc/vite/react.tsx",
			},
		}),
		slotAsset("trpc", {
			variants: {
				nextjs: "api/trpc/routes/nextjs/route.ts",
				"react-router": "api/trpc/routes/react-router/api.trpc.$.ts",
				"tanstack-start": "api/trpc/routes/tanstack-start/$.ts",
			},
		}),
	],
});

// The web frameworks that can render the tRPC client, whether they host the
// API themselves or talk to a standalone backend.
const trpcWebFrameworks = [
	nextjsFramework,
	reactRouterFramework,
	tanstackRouterFramework,
	tanstackStartFramework,
];

function trpcWebFramework(config: ForgeConfig) {
	return trpcWebFrameworks.find((framework) => framework.id === config.web);
}

export const trpcAdapters = deriveRecipeAdapters({
	recipe: trpcRecipe,
	frameworks: [nextjsFramework, reactRouterFramework, tanstackStartFramework],
	readTemplate,
	requiredSlots: ["trpc"],
	markers: (context: AdapterContext<ForgeConfig>) =>
		trpcRecipeMarkers(context.config, context.framework, false),
	target: (_asset, context) => moduleTarget(context.module),
	after: ({ config, module }) => [
		surfaceDependencies(
			moduleTarget(module),
			"packageJson",
			trpcWebDependencies(config.slug ?? "my-app"),
		),
		...expoTrpcClientContributions(config),
	],
});

export const trpcHonoRecipe = defineTemplateRecipe({
	addon: "trpc",
	markers: {
		SLUG: marker.required,
		AUTH_IMPORT: marker.toggleLine("// __AUTH_IMPORT__\n"),
		AUTH_ARG: marker.toggleInline("/* __AUTH_ARG__ */ "),
	},
	assets: [
		slotAsset("trpc", {
			variants: { hono: "api/trpc/routes/hono/trpc.ts" },
		}),
	],
});

export const trpcHonoAdapters = deriveRecipeAdapters({
	recipe: trpcHonoRecipe,
	frameworks: [honoFramework],
	readTemplate,
	requiredSlots: ["trpc"],
	markers: ({ config }: AdapterContext<ForgeConfig>) => {
		const values = trpcTemplateVars(config);
		return {
			SLUG: values.SLUG,
			AUTH_IMPORT: values["// __AUTH_IMPORT__\n"],
			AUTH_ARG: values["/* __AUTH_ARG__ */ "],
		};
	},
	target: (_asset, context) => moduleTarget(context.module),
	before: ({ config }) => {
		const webFramework = trpcWebFramework(config);
		if (webFramework === undefined) return expoTrpcClientContributions(config);

		const markers = trpcRecipeMarkers(config, webFramework, true);

		return [
			...trpcRecipe.assets
				.filter(
					(asset) =>
						asset._tag !== "SlotAssetDefinition" && asset.name !== "server",
				)
				.map((asset) => {
					const rendered = renderRecipeAsset(trpcRecipe, asset, webFramework, {
						markers,
						readTemplate,
						slots: {},
					});
					return leafTextFile(
						ensuredModuleTarget("web"),
						rendered.destination,
						rendered.content,
					);
				}),
			...expoTrpcClientContributions(config),
		];
	},
	after: ({ config, module }) => {
		const slug = config.slug ?? "my-app";

		return [
			surfaceDependencies(moduleTarget(module), "packageJson", [
				{ name: `@${slug}/trpc`, version: "workspace:*", type: "dependencies" },
				{ ...deps.honoTrpcServer, type: "dependencies" },
				{ ...deps.trpcServer, type: "dependencies" },
			]),
			...(trpcWebFramework(config) === undefined
				? []
				: [
						surfaceDependencies(
							ensuredModuleTarget("web"),
							"packageJson",
							trpcWebDependencies(slug),
						),
					]),
		];
	},
});

export const trpcFastifyRecipe = defineTemplateRecipe({
	addon: "trpc",
	markers: {
		SLUG: marker.required,
		AUTH_IMPORT: marker.toggleLine("// __AUTH_IMPORT__\n"),
		AUTH_ARG: marker.toggleLine("          /* __AUTH_ARG__ */\n"),
	},
	assets: [
		slotAsset("trpc", {
			variants: { fastify: "api/trpc/routes/fastify/trpc.ts" },
		}),
	],
});

export const trpcFastifyAdapters = deriveRecipeAdapters({
	recipe: trpcFastifyRecipe,
	frameworks: [fastifyFramework],
	readTemplate,
	requiredSlots: ["trpc"],
	markers: ({ config }: AdapterContext<ForgeConfig>) => {
		const values = trpcTemplateVars(config);
		return {
			SLUG: values.SLUG,
			AUTH_IMPORT: values["// __AUTH_IMPORT__\n"],
			AUTH_ARG:
				config.authentication === "better-auth" ? "          auth,\n" : "",
		};
	},
	target: (_asset, context) => moduleTarget(context.module),
	before: ({ config }) => {
		const webFramework = trpcWebFramework(config);
		if (webFramework === undefined) return expoTrpcClientContributions(config);

		const markers = trpcRecipeMarkers(config, webFramework, true);

		return [
			...trpcRecipe.assets
				.filter(
					(asset) =>
						asset._tag !== "SlotAssetDefinition" && asset.name !== "server",
				)
				.map((asset) => {
					const rendered = renderRecipeAsset(trpcRecipe, asset, webFramework, {
						markers,
						readTemplate,
						slots: {},
					});
					return leafTextFile(
						ensuredModuleTarget("web"),
						rendered.destination,
						rendered.content,
					);
				}),
			...expoTrpcClientContributions(config),
		];
	},
	after: ({ config, module }) => {
		const slug = config.slug ?? "my-app";

		return [
			surfaceDependencies(moduleTarget(module), "packageJson", [
				{ name: `@${slug}/trpc`, version: "workspace:*", type: "dependencies" },
				{ ...deps.trpcServer, type: "dependencies" },
			]),
			...(trpcWebFramework(config) === undefined
				? []
				: [
						surfaceDependencies(
							ensuredModuleTarget("web"),
							"packageJson",
							trpcWebDependencies(slug),
						),
					]),
		];
	},
});

export const trpcExpoRecipe = defineTemplateRecipe({
	addon: "trpc",
	markers: {
		SLUG: marker.required,
		AUTH_IMPORT: marker.toggleLine("// __AUTH_IMPORT__\n"),
		AUTH_HEADERS: marker.toggleLine("      // __AUTH_HEADERS__\n"),
	},
	assets: [
		sharedAsset("expo-client", {
			template: "api/trpc/expo/client.ts",
			destination: inSourceRoot("lib/trpc.ts"),
		}),
	],
});

export function expoTrpcClientContributions(config: ForgeConfig) {
	if (config.mobile !== "expo") return [];

	const markers = {
		SLUG: config.slug ?? "my-app",
		AUTH_IMPORT:
			config.authentication === "better-auth"
				? 'import { authClient } from "./auth-client";\n'
				: "",
		AUTH_HEADERS:
			config.authentication === "better-auth"
				? "      async headers() {\n        const cookies = await authClient.getCookie();\n        return cookies ? { Cookie: cookies } : {};\n      },\n"
				: "",
	};

	const asset = trpcExpoRecipe.assets[0];
	const rendered = renderRecipeAsset(trpcExpoRecipe, asset, expoFramework, {
		markers,
		readTemplate,
		slots: {},
	});

	const target = ensuredModuleTarget("mobile");

	return [
		leafTextFile(target, rendered.destination, rendered.content),
		surfaceDependencies(target, "packageJson", [
			{
				name: `@${markers.SLUG}/trpc`,
				version: "workspace:*",
				type: "dependencies",
			},
			{ ...deps.trpcClient, type: "dependencies" },
			{ ...deps.trpcServer, type: "dependencies" },
			{ ...deps.tanstackReactQuery, type: "dependencies" },
			{ ...deps.superjson, type: "dependencies" },
		]),
	];
}
