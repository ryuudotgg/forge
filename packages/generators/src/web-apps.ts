import type { ForgeConfig, WebFramework } from "./config";
import { standaloneBackendDevPort, webDevPort } from "./origins";

export interface WebAppConfig {
	readonly name: string;
	readonly framework: WebFramework;
	readonly client?: boolean;
}

export const reservedWebAppNames = [
	"web",
	"server",
	"mobile",
	"desktop",
	"worker",
	"auth",
	"db",
	"ui",
	"trpc",
	"orpc",
	"email",
	"shared",
	"tsconfig",
	"github",
] as const;

export interface WebAppInstance {
	readonly key: string;
	readonly root: string;
	readonly packageName: string;
	readonly framework: WebFramework;
	readonly port: number;
	readonly primary: boolean;
	readonly client?: boolean;
	readonly role?: "primary";
}

export function webAppInstances(config: ForgeConfig): WebAppInstance[] {
	if (config.web === undefined) return [];

	const slug = config.slug ?? "my-app";
	const secondaryApps = config.webApps ?? [];
	const primaryPort = webDevPort(config.web);
	const instances: WebAppInstance[] = [
		{
			key: "web",
			root: "apps/web",
			packageName: `@${slug}/web`,
			framework: config.web,
			port: primaryPort,
			primary: true,
			...(secondaryApps.length === 0 ? {} : { role: "primary" as const }),
		},
	];

	let port = primaryPort;
	for (const app of secondaryApps) {
		port += 1;
		if (port === standaloneBackendDevPort) port += 1;

		instances.push({
			key: app.name,
			root: `apps/${app.name}`,
			packageName: `@${slug}/${app.name}`,
			framework: app.framework,
			port,
			primary: false,
			...(app.client === true ? { client: true } : {}),
		});
	}

	return instances;
}

export function webAppRenderConfig(
	config: ForgeConfig,
	instance: WebAppInstance,
): ForgeConfig {
	return instance.primary
		? config
		: {
				...config,
				backend: instance.client === true ? config.backend : undefined,
				rpc: instance.client === true ? config.rpc : undefined,
				authentication:
					instance.client === true ? config.authentication : undefined,
				orm: undefined,
			};
}
