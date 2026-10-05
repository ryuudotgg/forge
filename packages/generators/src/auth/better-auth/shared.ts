import type { FrameworkDefinition } from "@ryuugg/core";
import type { ForgeConfig, WebFramework } from "../../config";
import {
	drizzleAdapterProvider,
	resolveDatabaseProvider,
} from "../../data/providers";
import { expoScheme } from "../../frameworks/expo";
import { nextjsFramework } from "../../frameworks/nextjs";
import { reactRouterFramework } from "../../frameworks/react-router";
import { tanstackRouterFramework } from "../../frameworks/tanstack-router";
import { tanstackStartFramework } from "../../frameworks/tanstack-start";
import {
	authEnvOrigins,
	hasSecondaryClients,
	standaloneApiOrigin,
} from "../../origins";
import { interpolate, readTemplate } from "../../template";
import {
	authSocialProviders,
	authUsesPasskey,
	authUsesPassword,
} from "../methods";
import {
	authPluginBindings,
	authPluginEnvEntries,
	authPluginImports,
	authPluginTables,
	authRefusesInvitations,
	authSendsEmail,
} from "../plugins";
import { authModels } from "../tables";

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

function authClientCall(
	config: ForgeConfig,
	standalone: boolean,
	secondary = false,
): string {
	const prefix = clientEnvPrefix(config);
	const baseUrl = secondary
		? `env.${prefix}SERVER_URL`
		: config.web === "nextjs"
			? `process.env.${prefix}SERVER_URL`
			: `import.meta.env.${prefix}SERVER_URL`;

	const plugins = authPluginBindings(config, "client");
	if (plugins.length > 0)
		return [
			"export const authClient = createAuthClient({",
			...(standalone
				? [
						`  baseURL: ${baseUrl},`,
						'  fetchOptions: { credentials: "include" },',
					]
				: []),
			`  plugins: [${plugins.map(({ name }) => `${name}()`).join(", ")}],`,
			"});",
			"",
		].join("\n");

	if (!standalone)
		return "export const authClient: ReturnType<typeof createAuthClient> =\n  createAuthClient();\n";

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
	const pluginEnv = authPluginEnvEntries(config);
	const secondaryPasskeys =
		hasSecondaryClients(config) && authUsesPasskey(config);

	return {
		SLUG: slug,
		PASSKEY_ORIGIN:
			standalone && config.web !== undefined ? "env.WEB_URL" : "env.APP_ORIGIN",
		PASSKEY_ALLOWED_ORIGINS: hasSecondaryClients(config)
			? "webOrigins"
			: "relyingParty.origin",
		PASSKEY_RP_ID: secondaryPasskeys
			? "env.PASSKEY_RP_ID ?? relyingParty.hostname"
			: "relyingParty.hostname",
		APP_NAME: JSON.stringify(config.name ?? slug),
		AUTH_ENV_NAMES: hasSecondaryClients(config) ? "env, webOrigins" : "env",
		"__WEB_ORIGINS__\n": authEnvOrigins(config),
		DATASOURCE_PROVIDER: provider.prisma.datasourceProvider,
		DRIZZLE_PROVIDER: drizzleAdapterProvider(provider.dialect),
		"// __CLIENT_PLUGIN_IMPORTS__\n": authPluginImports(
			authPluginBindings(config, "client"),
		),
		"// __CLIENT_ENV_TYPES__\n":
			standalone && config.web !== "nextjs"
				? `\ndeclare global {\n  interface ImportMetaEnv {\n    readonly ${clientEnvPrefix(config)}SERVER_URL: string;\n  }\n\n  interface ImportMeta {\n    readonly env: ImportMetaEnv;\n  }\n}\n`
				: "",
		[authClientDeclaration]: authClientCall(config, standalone),
		"    // __WEB_URL_SCHEMA__\n": `${standalone ? "    WEB_URL: z.url(),\n" : ""}${hasSecondaryClients(config) ? "    WEB_URLS: z.string().optional(),\n" : ""}${secondaryPasskeys ? "    PASSKEY_RP_ID: z.string().trim().min(1).optional(),\n" : ""}`,
		"    // __WEB_URL_RUNTIME__\n": `${standalone ? "    WEB_URL: process.env.WEB_URL,\n" : ""}${hasSecondaryClients(config) ? "    WEB_URLS: process.env.WEB_URLS,\n" : ""}${secondaryPasskeys ? "    PASSKEY_RP_ID: process.env.PASSKEY_RP_ID,\n" : ""}`,
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
		"\n    __PLUGIN_SCHEMA__\n":
			pluginEnv.length > 0
				? `\n${pluginEnv.map(({ name, schema }) => `    ${name}: ${schema},\n`).join("")}`
				: "",
		"\n    __PLUGIN_RUNTIME__\n":
			pluginEnv.length > 0
				? `\n${pluginEnv.map(({ name, runtime }) => `    ${name}: ${runtime},\n`).join("")}`
				: "",
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
	const pluginImports = [
		...authPluginBindings(config, "server"),
		...(authRefusesInvitations(config)
			? [{ module: "better-auth/api", name: "APIError" }]
			: []),
		...(authSendsEmail(config)
			? [{ module: `@${values.SLUG}/email`, name: "sendEmail" }]
			: []),
		...(usesMobile ? [{ module: "@better-auth/expo", name: "expo" }] : []),
		...(isNextjs
			? [{ module: "better-auth/next-js", name: "nextCookies" }]
			: isTanstackStart
				? [
						{
							module: "better-auth/tanstack-start",
							name: "tanstackStartCookies",
						},
					]
				: []),
	];

	const plugins = [
		...authPluginBindings(config, "server").map(
			({ name, call }) => call ?? `${name}()`,
		),
		usesMobile ? "expo()" : undefined,
		isNextjs
			? "nextCookies()"
			: isTanstackStart
				? "tanstackStartCookies()"
				: undefined,
	].filter((plugin) => plugin !== undefined);

	const webOrigins = hasSecondaryClients(config)
		? "...webOrigins"
		: standaloneApiOrigin(config)
			? "env.WEB_URL"
			: undefined;

	const trustedOrigins = [
		webOrigins,
		usesMobile ? `"${expoScheme(values.SLUG)}://"` : undefined,
	].filter((origin) => origin !== undefined);

	return {
		...values,
		ADAPTER_SCHEMA_IMPORT:
			authPluginTables(config).length === 0
				? `import { accounts, sessions, users, verifications } from "@${values.SLUG}/db/schema";\n`
				: authPluginImports([
						...["accounts", "sessions", "users", "verifications"].map(
							(name) => ({
								module: `@${values.SLUG}/db/schema`,
								name,
							}),
						),
						...authPluginTables(config).map(({ model }) => ({
							module: `@${values.SLUG}/db/schema`,
							name: authModels[model].table,
						})),
					]),
		ADAPTER_MODELS: authPluginTables(config)
			.map(({ model }) => `      ${model}: ${authModels[model].table},\n`)
			.join(""),
		SCOPED_PLUGIN_IMPORTS: authPluginImports(
			pluginImports.filter(({ module }) => module.startsWith("@")),
		),
		PLUGIN_IMPORTS: authPluginImports(
			pluginImports.filter(
				({ module }) => !module.startsWith(".") && !module.startsWith("@"),
			),
		),
		RELATIVE_PLUGIN_IMPORTS: authPluginImports(
			pluginImports.filter(({ module }) => module.startsWith(".")),
		),
		PLUGINS:
			plugins.length === 0
				? ""
				: `  plugins: [${plugins.join(", ")}],`.length <= 80
					? `  plugins: [${plugins.join(", ")}],\n\n`
					: `  plugins: [\n${plugins.map((plugin) => `    ${plugin},\n`).join("")}  ],\n\n`,
		TRUSTED_ORIGINS:
			trustedOrigins.length === 0
				? ""
				: trustedOrigins.length === 1 && webOrigins === "...webOrigins"
					? "  trustedOrigins: webOrigins,\n"
					: `  trustedOrigins: [${trustedOrigins.join(", ")}],\n`,
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

export function renderSecondaryAuthClient(
	config: ForgeConfig,
	framework: WebFramework,
): string {
	const clientConfig = { ...config, web: framework };
	return interpolate(
		readTemplate("auth/better-auth/packages/auth/src/client.ts"),
		{
			"// __CLIENT_PLUGIN_IMPORTS__\n": authPluginImports(
				authPluginBindings(config, "client"),
			),
			"// __CLIENT_ENV_TYPES__\n": `import { env } from "${framework === "nextjs" ? "../env" : "../../env"}";\n`,
			[authClientDeclaration]: authClientCall(clientConfig, true, true),
		},
	);
}
