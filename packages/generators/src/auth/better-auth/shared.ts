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

export function renderBetterAuthTemplate(
	config: ForgeConfig,
	path: string,
): string {
	return interpolate(
		readTemplate(`auth/better-auth/${path}`),
		betterAuthTemplateVars(config),
	);
}
