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

export const trpcTanstackStartAdapter = defineAdapter<ForgeConfig>({
	addon: "trpc",
	framework: "tanstack-start",
	requiredSlots: ["trpc"],
	contribute: (context) => {
		const slug = context.config.slug ?? "my-app";
		const target = moduleTarget(context.module);

		return [
			leafTextFile(
				target,
				"src/trpc/query-client.ts",
				renderTrpcTemplate(
					context.config,
					"tanstack-start/apps/web/src/trpc/query-client.ts",
				),
			),
			leafTextFile(
				target,
				"src/trpc/server.ts",
				renderTrpcTemplate(
					context.config,
					"tanstack-start/apps/web/src/trpc/server.ts",
				),
			),
			leafTextFile(
				target,
				"src/trpc/react.tsx",
				renderTrpcTemplate(
					context.config,
					"tanstack-start/apps/web/src/trpc/react.tsx",
				),
			),
			leafTextFile(
				target,
				slotPath(target, "trpc"),
				renderTrpcTemplate(
					context.config,
					"tanstack-start/apps/web/src/routes/api/trpc/$.ts",
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
