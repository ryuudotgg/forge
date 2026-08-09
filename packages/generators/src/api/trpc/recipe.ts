import type { AdapterContext } from "@ryuujs/core";
import {
	defineTemplateRecipe,
	inSourceRoot,
	marker,
	moduleTarget,
	sharedAsset,
	slotAsset,
	surfaceDependencies,
	variantAsset,
} from "@ryuujs/core";
import type { ForgeConfig } from "../../config";
import { deps } from "../../deps";
import { nextjsFramework } from "../../frameworks/nextjs";
import { reactRouterFramework } from "../../frameworks/react-router";
import { tanstackStartFramework } from "../../frameworks/tanstack-start";
import { deriveRecipeAdapters } from "../../registry/recipe-adapters";
import { readTemplate } from "../../template";
import { trpcTemplateVars } from "./shared";

export const trpcRecipe = defineTemplateRecipe({
	addon: "trpc",
	markers: {
		SLUG: marker.required,
		AUTH_IMPORT: marker.toggleLine("// __AUTH_IMPORT__\n"),
		AUTH_ARG: marker.toggleInline("/* __AUTH_ARG__ */ "),
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
				"tanstack-start": "api/trpc/request/server.ts",
			},
		}),
		variantAsset("react", {
			destination: inSourceRoot("trpc/react.tsx"),
			variants: {
				nextjs: "api/trpc/rsc/react.tsx",
				"react-router": "api/trpc/vite/react.tsx",
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

export const trpcAdapters = deriveRecipeAdapters({
	recipe: trpcRecipe,
	frameworks: [nextjsFramework, reactRouterFramework, tanstackStartFramework],
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
	after: ({ config, module }) => {
		const slug = config.slug ?? "my-app";

		return [
			surfaceDependencies(moduleTarget(module), "packageJson", [
				{
					name: `@${slug}/trpc`,
					version: "workspace:*",
					type: "dependencies",
				},
				{ ...deps.trpcClient, type: "dependencies" },
				{ ...deps.trpcReactQuery, type: "dependencies" },
				{ ...deps.trpcServer, type: "dependencies" },
				{ ...deps.tanstackReactQuery, type: "dependencies" },
				{ ...deps.superjson, type: "dependencies" },
			]),
		];
	},
});
