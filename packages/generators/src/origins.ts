import type { ForgeConfig, WebFramework } from "./config";

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

export function appOrigin(config: ForgeConfig): string {
	return standaloneApiOrigin(config) ?? webDevOrigin(config);
}

export function viteServerEnvMarkers(config: ForgeConfig) {
	const origin = standaloneApiOrigin(config);
	return {
		"  // __SERVER_ENV__\n  client: {},\n":
			origin === undefined
				? "  client: {},\n"
				: `  client: {\n    VITE_SERVER_URL: z.url().default("${origin}"),\n  },\n`,
	};
}

export function nextServerEnvMarkers(config: ForgeConfig) {
	const origin = standaloneApiOrigin(config);
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
