import type { FrameworkDefinition } from "@ryuugg/core";
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
import { authSocialProviders, authUsesPassword } from "../methods";

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
	const providers = authSocialProviders(config);
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
		"\n    // __SOCIAL_SCHEMA__\n": providers
			.map(({ envStem }) =>
				[
					"",
					`    ${envStem}_CLIENT_ID: z.string().trim().min(1).optional(),`,
					`    ${envStem}_CLIENT_SECRET: z.string().trim().min(1).optional(),`,
					"",
				].join("\n"),
			)
			.join(""),
		"\n    // __SOCIAL_RUNTIME__\n": providers
			.map(({ envStem }) =>
				[
					"",
					`    ${envStem}_CLIENT_ID: process.env.${envStem}_CLIENT_ID,`,
					`    ${envStem}_CLIENT_SECRET: process.env.${envStem}_CLIENT_SECRET,`,
					"",
				].join("\n"),
			)
			.join(""),
	};
}

function socialProvidersFunction(config: ForgeConfig): string {
	const providers = authSocialProviders(config);
	if (providers.length === 0) return "";

	const declarations = providers.map(({ id, envStem }) =>
		[
			`  const ${id} =`,
			`    env.${envStem}_CLIENT_ID && env.${envStem}_CLIENT_SECRET`,
			"      ? {",
			`          clientId: env.${envStem}_CLIENT_ID,`,
			`          clientSecret: env.${envStem}_CLIENT_SECRET,`,
			`          redirectURI: \`\${normalizeOrigin(env.APP_ORIGIN)}/api/auth/callback/${id}\`,`,
			"        }",
			"      : null;",
			"",
		].join("\n"),
	);

	return [
		"function getSocialProviders() {",
		declarations.join("\n"),
		`  if (${providers.map(({ id }) => `!${id}`).join(" && ")}) return null;`,
		"",
		"  return {",
		...[...providers]
			.reverse()
			.map(({ id }) => `    ...(${id} ? { ${id} } : {}),`),
		"  };",
		"}",
		"",
		"",
	].join("\n");
}

export function betterAuthRecipeVars(
	config: ForgeConfig,
	framework: FrameworkDefinition,
) {
	const values = betterAuthTemplateVars(config);
	const isNextjs = framework.id === "nextjs";
	const isTanstackStart = framework.id === "tanstack-start";
	const usesMobile = config.mobile === "expo";
	const usesSocial = authSocialProviders(config).length > 0;
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
		EMAIL_PASSWORD: authUsesPassword(config)
			? "  emailAndPassword: { enabled: true },\n"
			: "",
		SOCIAL_DECLARATION: usesSocial
			? "const socialProviders = getSocialProviders();\n"
			: "",
		SOCIAL_OPTION: usesSocial
			? "  ...(socialProviders ? { socialProviders } : {}),\n\n"
			: "",
		SOCIAL_FUNCTION: socialProvidersFunction(config),
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
