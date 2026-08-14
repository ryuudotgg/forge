import type { FrameworkDefinition } from "@ryuujs/core";
import type { ForgeConfig } from "../../config";
import {
	drizzleAdapterProvider,
	resolveDatabaseProvider,
} from "../../data/providers";
import { standaloneApiOrigin } from "../../origins";
import { interpolate, readTemplate } from "../../template";

// Only one of the two call shapes fits the generated formatter's line budget,
// so the whole declaration is the marker rather than just its argument.
const authClientDeclaration =
	"export const authClient: ReturnType<typeof createAuthClient> =\n  createAuthClient(__CLIENT_OPTIONS__);\n";

function authClientCall(config: ForgeConfig, standalone: boolean): string {
	if (!standalone)
		return "export const authClient: ReturnType<typeof createAuthClient> =\n  createAuthClient();\n";

	const baseUrl =
		config.web === "nextjs"
			? "process.env.NEXT_PUBLIC_SERVER_URL"
			: "import.meta.env.VITE_SERVER_URL";

	return [
		"export const authClient: ReturnType<typeof createAuthClient> = createAuthClient(",
		"  {",
		`    baseURL: ${baseUrl},`,
		'    fetchOptions: { credentials: "include" },',
		"  },",
		");",
		"",
	].join("\n");
}

export function betterAuthTemplateVars(config: ForgeConfig) {
	const slug = config.slug ?? "my-app";
	const provider = resolveDatabaseProvider(config);
	const standalone = standaloneApiOrigin(config) !== undefined;

	return {
		SLUG: slug,
		DATASOURCE_PROVIDER: provider.prisma.datasourceProvider,
		DRIZZLE_PROVIDER: drizzleAdapterProvider(provider.dialect),
		"// __CLIENT_ENV_TYPES__\n":
			standalone && config.web !== "nextjs"
				? "\ndeclare global {\n  interface ImportMetaEnv {\n    readonly VITE_SERVER_URL: string;\n  }\n\n  interface ImportMeta {\n    readonly env: ImportMetaEnv;\n  }\n}\n"
				: "",
		[authClientDeclaration]: authClientCall(config, standalone),
		"    // __WEB_URL_SCHEMA__\n": standalone ? "    WEB_URL: z.url(),\n" : "",
		"    // __WEB_URL_RUNTIME__\n": standalone
			? "    WEB_URL: process.env.WEB_URL,\n"
			: "",
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
		TRUSTED_ORIGINS: standaloneApiOrigin(config)
			? "  trustedOrigins: [env.WEB_URL],\n"
			: "",
		EMAIL_PASSWORD: standaloneApiOrigin(config)
			? "  emailAndPassword: { enabled: true },\n"
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
