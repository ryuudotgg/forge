import {
	defineAdapter,
	ensuredModuleTarget,
	leafTextFile,
	moduleTarget,
	slotPath,
	surfaceDependencies,
} from "@ryuujs/core";
import type { ForgeConfig } from "../../../config";
import { deps } from "../../../deps";
import { renderBetterAuthTemplate } from "../shared";

export const betterAuthTanstackStartAdapter = defineAdapter<ForgeConfig>({
	addon: "better-auth",
	framework: "tanstack-start",
	requiredSlots: ["auth"],
	contribute: (context) => {
		const slug = context.config.slug ?? "my-app";
		const target = moduleTarget(context.module);

		return [
			leafTextFile(
				ensuredModuleTarget("auth"),
				"src/index.ts",
				renderBetterAuthTemplate(
					context.config,
					`tanstack-start/packages/auth/src/index.${context.config.orm}.ts`,
				),
			),
			leafTextFile(
				target,
				slotPath(target, "auth"),
				renderBetterAuthTemplate(
					context.config,
					"tanstack-start/apps/web/src/routes/api/auth/$.ts",
				),
			),
			surfaceDependencies(target, "packageJson", [
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
