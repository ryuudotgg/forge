import type { ForgeConfig, WebFramework } from "./config";
import {
	emailPreviewPort,
	standaloneBackendDevPort,
	webDevPort,
} from "./origins";

export interface WebAppConfig {
	readonly name: string;
	readonly framework: WebFramework;
	readonly client?: boolean;
	readonly port?: number;
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

	let positionalPort = primaryPort;
	for (const app of secondaryApps) {
		positionalPort += 1;
		if (positionalPort === standaloneBackendDevPort) positionalPort += 1;

		instances.push({
			key: app.name,
			root: `apps/${app.name}`,
			packageName: `@${slug}/${app.name}`,
			framework: app.framework,
			port: app.port ?? positionalPort,
			primary: false,
			...(app.client === true ? { client: true } : {}),
		});
	}

	return instances;
}

export function withWebAppPorts(config: ForgeConfig): ForgeConfig {
	const secondaryApps = config.webApps ?? [];
	if (config.web === undefined || secondaryApps.length === 0) return config;

	const ports = webAppInstances(config)
		.filter((instance) => !instance.primary)
		.map((instance) => instance.port);

	return {
		...config,
		webApps: secondaryApps.map((app, index) => ({
			...app,
			port: ports[index] ?? app.port,
		})),
	};
}

const highestPort = 65535;
export function addWebAppConfig(
	config: ForgeConfig,
	app: WebAppConfig,
): ForgeConfig {
	const stamped = withWebAppPorts(config);
	const usedPorts = new Set([
		standaloneBackendDevPort,
		emailPreviewPort,
		...webAppInstances(stamped).map((instance) => instance.port),
	]);

	let port = webDevPort(config.web) + 1;
	while (usedPorts.has(port)) port += 1;

	if (port > highestPort)
		throw new Error(`Web App Port Unavailable: ${app.name}`);

	return {
		...stamped,
		webApps: [...(stamped.webApps ?? []), { ...app, port }],
	};
}

export function removeWebAppConfig(
	config: ForgeConfig,
	name: string,
): ForgeConfig {
	const stamped = withWebAppPorts(config);
	return {
		...stamped,
		webApps: (stamped.webApps ?? []).filter((app) => app.name !== name),
	};
}

export function webAppPortIssue(config: ForgeConfig): string | undefined {
	const owners = new Map<number, string>(
		config.emailProvider === undefined
			? []
			: [[emailPreviewPort, "the email preview"]],
	);

	for (const instance of webAppInstances(config)) {
		const owner = owners.get(instance.port);
		if (owner !== undefined)
			return `${owner} and ${instance.key} both use port ${instance.port}.`;

		owners.set(instance.port, instance.key);
	}
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
