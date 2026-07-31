import type { ForgeConfig } from "../config";
import { interpolate, readTemplate } from "../template";

export function uiStyle(config: ForgeConfig) {
	return (config.uiLibrary ?? "base-ui") === "base-ui"
		? "base-vega"
		: "radix-vega";
}

export function renderUiTemplate(config: ForgeConfig, path: string): string {
	return interpolate(readTemplate(`ui/${path}`), {
		SHADCN_STYLE: uiStyle(config),
		SLUG: config.slug ?? "my-app",
	});
}

export function uiComponentsJson(config: ForgeConfig, rsc: boolean) {
	const slug = config.slug ?? "my-app";
	const shadcnStyle = uiStyle(config);

	return {
		$schema: "https://ui.shadcn.com/schema.json",
		style: shadcnStyle,
		rsc,
		tsx: true,
		tailwind: {
			config: "",
			css: "src/styles/globals.css",
			baseColor: "neutral",
			cssVariables: true,
		},
		iconLibrary: "lucide",
		aliases: {
			components: `@${slug}/ui/components`,
			utils: `@${slug}/ui/lib/utils`,
			hooks: `@${slug}/ui/hooks`,
			lib: `@${slug}/ui/lib`,
			ui: `@${slug}/ui/components`,
		},
	};
}
