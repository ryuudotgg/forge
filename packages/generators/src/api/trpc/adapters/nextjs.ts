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

export const trpcNextjsAdapter = defineAdapter<ForgeConfig>({
	addon: "trpc",
	framework: "nextjs",
	requiredSlots: ["trpc"],
	contribute: (context) => {
		const slug = context.config.slug ?? "my-app";
		const target = moduleTarget(context.module);

		return [
			leafTextFile(
				target,
				"trpc/query-client.ts",
				renderTrpcTemplate(
					context.config,
					"nextjs/apps/web/trpc/query-client.ts",
				),
			),
			leafTextFile(
				target,
				"trpc/server.ts",
				renderTrpcTemplate(context.config, "nextjs/apps/web/trpc/server.ts"),
			),
			leafTextFile(
				target,
				"trpc/react.tsx",
				renderTrpcTemplate(context.config, "nextjs/apps/web/trpc/react.tsx"),
			),
			leafTextFile(
				target,
				slotPath(target, "trpc"),
				renderTrpcTemplate(
					context.config,
					"nextjs/apps/web/app/api/trpc/[trpc]/route.ts",
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
