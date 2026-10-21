import {
	type ForgeConfig,
	primaryWebAppName,
	secondaryClientOrigins,
	webAppInstances,
	webFrameworks,
} from "@ryuugg/generators";

export function webAppLabels(config: ForgeConfig): string[] {
	if (!config.webApps?.length && primaryWebAppName(config) === "web")
		return config.web ? [webFrameworks.label(config.web)] : [];

	return webAppInstances(config).map(
		(app) => `${app.key} (${webFrameworks.label(app.framework)})`,
	);
}

function webAppOrigin(config: ForgeConfig, name: string) {
	const instance = webAppInstances(config).find(
		(entry) => !entry.primary && entry.key === name,
	);

	if (instance === undefined) throw new Error(`Web App Not Found: ${name}`);
	return `http://localhost:${instance.port}`;
}

function localWebUrls(config: ForgeConfig) {
	return `WEB_URLS="${secondaryClientOrigins(config).join(",")}"`;
}

export function addedClientEnvMessage(config: ForgeConfig, name: string) {
	return `Add ${webAppOrigin(config, name)} to WEB_URLS in .env so ${name} can call the API. With only local apps, that makes ${localWebUrls(config)}.`;
}

export function removedClientEnvMessage(
	previousConfig: ForgeConfig,
	nextConfig: ForgeConfig,
	name: string,
) {
	if (secondaryClientOrigins(nextConfig).length === 0)
		return "Remove WEB_URLS from .env: no secondary web app calls the API now.";

	return `Remove ${webAppOrigin(previousConfig, name)} from WEB_URLS in .env. With only local apps, that leaves ${localWebUrls(nextConfig)}.`;
}
