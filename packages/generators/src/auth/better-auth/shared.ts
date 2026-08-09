import type { FrameworkDefinition } from "@ryuujs/core";
import type { ForgeConfig } from "../../config";
import {
	drizzleAdapterProvider,
	resolveDatabaseProvider,
} from "../../data/providers";
import { interpolate, readTemplate } from "../../template";

export function betterAuthTemplateVars(config: ForgeConfig) {
	const slug = config.slug ?? "my-app";
	const provider = resolveDatabaseProvider(config);

	return {
		SLUG: slug,
		DATASOURCE_PROVIDER: provider.prisma.datasourceProvider,
		DRIZZLE_PROVIDER: drizzleAdapterProvider(provider.dialect),
	};
}

export function betterAuthRecipeVars(
	config: ForgeConfig,
	framework: FrameworkDefinition,
) {
	const values = betterAuthTemplateVars(config);
	const isNextjs = framework.id === "nextjs";
	const isTanstackStart = framework.id === "tanstack-start";

	return {
		...values,
		COOKIE_IMPORT: isNextjs
			? 'import { nextCookies } from "better-auth/next-js";\n'
			: isTanstackStart
				? 'import { tanstackStartCookies } from "better-auth/tanstack-start";\n'
				: "",
		COOKIE_PLUGIN: isNextjs
			? "  plugins: [nextCookies()],\n\n"
			: isTanstackStart
				? "  plugins: [tanstackStartCookies()],\n\n"
				: "",
	};
}

export function renderBetterAuthTemplate(
	config: ForgeConfig,
	path: string,
): string {
	return interpolate(
		readTemplate(`auth/better-auth/${path}`),
		betterAuthTemplateVars(config),
	);
}
