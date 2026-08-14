import type { ForgeConfig } from "./config";

const standaloneBackendOrigins = new Map<string, string>([
	["hono", "http://localhost:3001"],
]);

const webDevOrigins = new Map<string, string>([
	["react-router", "http://localhost:5173"],
]);

const defaultWebOrigin = "http://localhost:3000";

export function standaloneApiOrigin(config: ForgeConfig): string | undefined {
	return config.backend === undefined
		? undefined
		: standaloneBackendOrigins.get(config.backend);
}

export function webDevOrigin(config: ForgeConfig): string {
	return config.web === undefined
		? defaultWebOrigin
		: (webDevOrigins.get(config.web) ?? defaultWebOrigin);
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
