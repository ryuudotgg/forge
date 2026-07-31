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

export const betterAuthNextjsAdapter = defineAdapter<ForgeConfig>({
	addon: "better-auth",
	framework: "nextjs",
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
					`nextjs/packages/auth/src/index.${context.config.orm}.ts`,
				),
			),
			leafTextFile(
				target,
				slotPath(target, "auth"),
				renderBetterAuthTemplate(
					context.config,
					"nextjs/apps/web/app/api/auth/[...all]/route.ts",
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
