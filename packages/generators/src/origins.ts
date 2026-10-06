import type { ForgeConfig, WebFramework } from "./config";
import { type WebAppInstance, webAppInstances } from "./web-apps";

export const standaloneBackendDevPort = 3001;
export const emailPreviewPort = 3883;

export function webDevPort(framework?: WebFramework): number {
	return framework === "react-router" ? 5173 : 3000;
}

const standaloneBackendOrigins = new Map<string, string>([
	["express", `http://localhost:${standaloneBackendDevPort}`],
	["fastify", `http://localhost:${standaloneBackendDevPort}`],
	["hono", `http://localhost:${standaloneBackendDevPort}`],
]);

export function standaloneApiOrigin(config: ForgeConfig): string | undefined {
	return config.backend === undefined
		? undefined
		: standaloneBackendOrigins.get(config.backend);
}

export function webDevOrigin(config: ForgeConfig): string {
	return `http://localhost:${webDevPort(config.web)}`;
}

export function hasSecondaryClients(config: ForgeConfig): boolean {
	return webAppInstances(config).some((instance) => instance.client === true);
}

export function secondaryClientOrigins(config: ForgeConfig): string[] {
	return webAppInstances(config)
		.filter((instance) => instance.client === true)
		.map((instance) => `http://localhost:${instance.port}`);
}

export type WebOriginsOwner =
	| {
			readonly kind: "auth-env";
			readonly primary: "WEB_URL" | "APP_ORIGIN";
	  }
	| { readonly kind: "server-env" }
	| { readonly kind: "cors-file" };

export function webOriginsOwner(
	config: ForgeConfig,
): WebOriginsOwner | undefined {
	if (!hasSecondaryClients(config)) return undefined;

	const standalone = standaloneApiOrigin(config) !== undefined;
	if (config.authentication === "better-auth")
		return {
			kind: "auth-env",
			primary: standalone ? "WEB_URL" : "APP_ORIGIN",
		};

	return standalone ? { kind: "server-env" } : { kind: "cors-file" };
}

const originListSource = [
	"function originList(sources: Record<string, string | undefined>) {",
	"  const origins = Object.entries(sources).flatMap(([name, value]) =>",
	'    (value?.split(",") ?? [])',
	"      .map((entry) => entry.trim())",
	'      .filter((entry) => entry !== "")',
	"      .map((entry) => toWebOrigin(name, entry)),",
	"  );",
	"",
	"  return [...new Set(origins)];",
	"}",
	"",
	"function toWebOrigin(name: string, value: string) {",
	"  const url = URL.canParse(value) ? new URL(value) : undefined;",
	'  if (url?.protocol === "http:" || url?.protocol === "https:")',
	"    return url.origin;",
	"",
	"  throw new Error(`${name} holds ${value}, which is not an http or https URL.`);",
	"}",
	"",
].join("\n");

type OriginSource = readonly [name: string, expression: string];

function webOriginsDeclaration(
	keyword: "export const" | "const",
	sources: ReadonlyArray<OriginSource>,
): string {
	const entries = sources
		.map(([name, expression]) => `  ${name}: ${expression},\n`)
		.join("");

	return `${keyword} webOrigins = originList({\n${entries}});\n\n${originListSource}`;
}

export function authEnvOrigins(config: ForgeConfig): string {
	const owner = webOriginsOwner(config);
	return owner?.kind === "auth-env"
		? `\n${webOriginsDeclaration("export const", [
				[owner.primary, `env.${owner.primary}`],
				["WEB_URLS", "env.WEB_URLS"],
			])}`
		: "";
}

export function withServerEnvOrigins(
	config: ForgeConfig,
	content: string,
): string {
	const owner = webOriginsOwner(config);
	if (owner?.kind === "server-env") {
		const declaration = webOriginsDeclaration("export const", [
			["WEB_URL", "env.WEB_URL"],
			["WEB_URLS", "env.WEB_URLS"],
		]);

		return `${content.replace(/( {4}WEB_URL: .*\n)/, "$1    WEB_URLS: z.string().optional(),\n")}\n${declaration}`;
	}

	if (owner?.kind === "auth-env")
		return `${content}\nexport { webOrigins } from "@${config.slug ?? "my-app"}/auth/env";\n`;

	return content;
}

export function serverCorsMarkers(config: ForgeConfig) {
	return hasSecondaryClients(config)
		? { SERVER_ENV_BINDING: "webOrigins", WEB_ORIGINS: "webOrigins" }
		: { SERVER_ENV_BINDING: "env", WEB_ORIGINS: "env.WEB_URL" };
}

export function selfHostedOriginsSource(config: ForgeConfig): string {
	return webOriginsOwner(config)?.kind === "auth-env"
		? `import { webOrigins } from "@${config.slug ?? "my-app"}/auth/env";`
		: webOriginsDeclaration("const", [
				["WEB_URLS", "process.env.WEB_URLS"],
			]).trimEnd();
}

export function webOriginsCors(config: ForgeConfig, content: string): string {
	const headers =
		config.rpc === "trpc" ? withTrpcStreamingHeader(content) : content;

	return hasSecondaryClients(config)
		? headers
				.replace(
					'import { env } from "../env.js";',
					'import { webOrigins } from "../env.js";',
				)
				.replace("origin: env.WEB_URL,", "origin: webOrigins,")
		: headers;
}

const trpcSourceHeaders =
	/^( *)allowedHeaders: \["Content-Type", "Authorization", "x-trpc-source"\],\n/m;

const trpcStreamingHeaders = [
	"Content-Type",
	"Authorization",
	"x-trpc-source",
	"trpc-accept",
];

function withTrpcStreamingHeader(content: string): string {
	return content.replace(
		trpcSourceHeaders,
		(_line, indent: string) =>
			`${indent}allowedHeaders: [\n${trpcStreamingHeaders.map((header) => `${indent}  "${header}",\n`).join("")}${indent}],\n`,
	);
}

export function appOrigin(config: ForgeConfig): string {
	return standaloneApiOrigin(config) ?? webDevOrigin(config);
}

function clientApiOrigin(
	config: ForgeConfig,
	instance: WebAppInstance,
): string | undefined {
	if (instance.client === true) return appOrigin(config);
	return instance.primary ? standaloneApiOrigin(config) : undefined;
}

export function viteServerEnvMarkers(
	config: ForgeConfig,
	instance: WebAppInstance,
) {
	const origin = clientApiOrigin(config, instance);
	return {
		"  // __SERVER_ENV__\n  client: {},\n":
			origin === undefined
				? "  client: {},\n"
				: `  client: {\n    VITE_SERVER_URL:\n      import.meta.env?.PROD || processEnv.NODE_ENV === "production"\n        ? z.url()\n        : z.url().default("${origin}"),\n  },\n`,
	};
}

export function nextServerEnvMarkers(
	config: ForgeConfig,
	instance: WebAppInstance,
) {
	const origin = clientApiOrigin(config, instance);
	return {
		"  // __SERVER_ENV__\n":
			origin === undefined
				? ""
				: `  client: {\n    NEXT_PUBLIC_SERVER_URL:\n      process.env.NODE_ENV === "production"\n        ? z.url()\n        : z.url().default("${origin}"),\n  },\n`,
		"  // __SERVER_RUNTIME__\n  experimental__runtimeEnv: process.env,\n":
			origin === undefined
				? "  experimental__runtimeEnv: process.env,\n"
				: "  experimental__runtimeEnv: {\n    NEXT_PUBLIC_SERVER_URL: process.env.NEXT_PUBLIC_SERVER_URL,\n    NODE_ENV: process.env.NODE_ENV,\n  },\n",
	};
}
