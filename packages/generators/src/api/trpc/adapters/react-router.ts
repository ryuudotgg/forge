import {
	defineAdapter,
	leafTextFile,
	moduleTarget,
	slotPath,
	surfaceDependencies,
} from "@ryuujs/core";
import type { ForgeConfig } from "../../../config";
import { deps } from "../../../deps";
import { renderTrpcTemplate } from "../shared";

export const trpcReactRouterAdapter = defineAdapter<ForgeConfig>({
	addon: "trpc",
	framework: "react-router",
	requiredSlots: ["trpc"],
	contribute: (context) => {
		const slug = context.config.slug ?? "my-app";
		const target = moduleTarget(context.module);

		return [
			leafTextFile(
				target,
				"app/trpc/query-client.ts",
				renderTrpcTemplate(
					context.config,
					"react-router/apps/web/app/trpc/query-client.ts",
				),
			),
			leafTextFile(
				target,
				"app/trpc/server.ts",
				renderTrpcTemplate(
					context.config,
					"react-router/apps/web/app/trpc/server.ts",
				),
			),
			leafTextFile(
				target,
				"app/trpc/react.tsx",
				renderTrpcTemplate(
					context.config,
					"react-router/apps/web/app/trpc/react.tsx",
				),
			),
			leafTextFile(
				target,
				slotPath(target, "trpc"),
				renderTrpcTemplate(
					context.config,
					"react-router/apps/web/app/routes/api.trpc.$.ts",
				),
			),
			surfaceDependencies(target, "packageJson", [
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
