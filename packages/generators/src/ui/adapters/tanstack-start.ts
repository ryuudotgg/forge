import {
	defineAdapter,
	ensuredModuleTarget,
	leafTextFile,
	moduleTarget,
	surfaceDependencies,
} from "@ryuujs/core";
import type { ForgeConfig } from "../../config";
import { deps } from "../../deps";
import { renderUiTemplate, uiComponentsJson } from "../shared";

export const uiTanstackStartAdapter = defineAdapter<ForgeConfig>({
	addon: "ui",
	framework: "tanstack-start",
	contribute: (context) => {
		const useTailwind = context.config.style === "tailwind";
		const target = moduleTarget(context.module);
		const webTailwindDeps: Array<{
			name: string;
			version: string;
			catalog?: string;
			type: "devDependencies";
		}> = [];

		if (useTailwind) {
			webTailwindDeps.push({
				...deps.tailwindcss,
				type: "devDependencies",
			});

			webTailwindDeps.push({
				...deps.tailwindVite,
				type: "devDependencies",
			});
		}

		return [
			...(webTailwindDeps.length > 0
				? [surfaceDependencies(target, "packageJson", webTailwindDeps)]
				: []),
			leafTextFile(
				ensuredModuleTarget("ui"),
				"components.json",
				`${JSON.stringify(uiComponentsJson(context.config, false), null, 2)}\n`,
			),
			leafTextFile(
				target,
				"components.json",
				renderUiTemplate(
					context.config,
					"tanstack-start/apps/web/components.json",
				),
			),
		];
	},
});
