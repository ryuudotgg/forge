import type { ForgeConfig, WebFramework } from "./config";
import { webAppInstances } from "./web-apps";

export const standaloneBackendDevPort = 3001;

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

export function webOriginsEnvSchema(config: ForgeConfig): string {
	return hasSecondaryClients(config)
		? `    WEB_URLS: z.string().default("${secondaryClientOrigins(config).join(",")}").transform((value) => value.split(",").map((origin) => origin.trim()).filter(Boolean)),\n`
		: "";
}

export function webOriginsCors(config: ForgeConfig, content: string): string {
	return hasSecondaryClients(config)
		? content
				.replace(
					"origin: env.WEB_URL,",
					"origin: [env.WEB_URL, ...env.WEB_URLS],",
				)
				.replace(
					'allowedHeaders: ["Content-Type", "Authorization", "x-trpc-source"],',
					'allowedHeaders: ["Content-Type", "Authorization", "x-trpc-source", "trpc-accept"],',
				)
		: content;
}

export function appOrigin(config: ForgeConfig): string {
	return standaloneApiOrigin(config) ?? webDevOrigin(config);
}

export function viteServerEnvMarkers(config: ForgeConfig) {
	const origin =
		standaloneApiOrigin(config) ??
		(hasSecondaryClients(config) ? webDevOrigin(config) : undefined);

	return {
		RUNTIME_ENV:
			config.rpc === "orpc"
				? '{ ...import.meta.env, ...(typeof process === "undefined" ? {} : process.env) }'
				: "{ ...import.meta.env, ...process.env }",
		SKIP_VALIDATION:
			config.rpc === "orpc"
				? 'typeof process !== "undefined" && (!!process.env.CI || shouldSkipValidation())'
				: "!!process.env.CI || shouldSkipValidation()",
		"  // __SERVER_ENV__\n  client: {},\n":
			origin === undefined
				? "  client: {},\n"
				: `  client: {\n    VITE_SERVER_URL: z.url().default("${origin}"),\n  },\n`,
	};
}

export function nextServerEnvMarkers(config: ForgeConfig) {
	const origin =
		standaloneApiOrigin(config) ??
		(hasSecondaryClients(config) ? webDevOrigin(config) : undefined);

	return {
		"  // __SERVER_ENV__\n":
			origin === undefined
				? ""
				: `  client: {\n    NEXT_PUBLIC_SERVER_URL: z.url().default("${origin}"),\n  },\n`,
		"  // __SERVER_RUNTIME__\n  experimental__runtimeEnv: process.env,\n":
			origin === undefined
				? "  experimental__runtimeEnv: process.env,\n"
				: "  experimental__runtimeEnv: {\n    NEXT_PUBLIC_SERVER_URL: process.env.NEXT_PUBLIC_SERVER_URL,\n    NODE_ENV: process.env.NODE_ENV,\n  },\n",
	};
}
