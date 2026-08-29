import type { FrameworkDefinition } from "@ryuujs/core";
import type { ForgeConfig } from "../../config";
import {
	drizzleAdapterProvider,
	resolveDatabaseProvider,
} from "../../data/providers";
import { expoScheme } from "../../frameworks/expo";
import { nextjsFramework } from "../../frameworks/nextjs";
import { reactRouterFramework } from "../../frameworks/react-router";
import { tanstackRouterFramework } from "../../frameworks/tanstack-router";
import { tanstackStartFramework } from "../../frameworks/tanstack-start";
import { standaloneApiOrigin } from "../../origins";
import { interpolate, readTemplate } from "../../template";

// Only one of the two call shapes fits the generated formatter's line budget,
// so the whole declaration is the marker rather than just its argument.
const authClientDeclaration =
	"export const authClient: ReturnType<typeof createAuthClient> =\n  createAuthClient(__CLIENT_OPTIONS__);\n";

const webFrameworks = [
	nextjsFramework,
	reactRouterFramework,
	tanstackRouterFramework,
	tanstackStartFramework,
];

function clientEnvPrefix(config: ForgeConfig): string {
	return (
		webFrameworks.find((framework) => framework.id === config.web)
			?.clientEnvPrefix ?? "VITE_"
	);
}

function authClientCall(config: ForgeConfig, standalone: boolean): string {
	if (!standalone)
		return "export const authClient: ReturnType<typeof createAuthClient> =\n  createAuthClient();\n";

	const prefix = clientEnvPrefix(config);
	const baseUrl =
		config.web === "nextjs"
			? `process.env.${prefix}SERVER_URL`
			: `import.meta.env.${prefix}SERVER_URL`;

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
				? `\ndeclare global {\n  interface ImportMetaEnv {\n    readonly ${clientEnvPrefix(config)}SERVER_URL: string;\n  }\n\n  interface ImportMeta {\n    readonly env: ImportMetaEnv;\n  }\n}\n`
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
	const usesMobile = config.mobile === "expo";
	const cookieImports = [
		usesMobile ? 'import { expo } from "@better-auth/expo";\n' : "",
		isNextjs
			? 'import { nextCookies } from "better-auth/next-js";\n'
			: isTanstackStart
				? 'import { tanstackStartCookies } from "better-auth/tanstack-start";\n'
				: "",
	];

	const cookiePlugins = [
		usesMobile ? "expo()" : undefined,
		isNextjs
			? "nextCookies()"
			: isTanstackStart
				? "tanstackStartCookies()"
				: undefined,
	].filter((plugin) => plugin !== undefined);

	const trustedOrigins = [
		standaloneApiOrigin(config) ? "env.WEB_URL" : undefined,
		usesMobile ? `"${expoScheme(values.SLUG)}://"` : undefined,
	].filter((origin) => origin !== undefined);

	return {
		...values,
		COOKIE_IMPORT: cookieImports.join(""),
		COOKIE_PLUGIN:
			cookiePlugins.length > 0
				? `  plugins: [${cookiePlugins.join(", ")}],\n\n`
				: "",
		TRUSTED_ORIGINS:
			trustedOrigins.length > 0
				? `  trustedOrigins: [${trustedOrigins.join(", ")}],\n`
				: "",
		EMAIL_PASSWORD:
			standaloneApiOrigin(config) || usesMobile
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
