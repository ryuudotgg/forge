import {
	type ForgeConfig,
	secondaryClientOrigins,
	webAppInstances,
	webFrameworks,
} from "@ryuugg/generators";
import { listAnd } from "./list";

export function webAppLabels(config: ForgeConfig): string[] {
	if (!config.webApps?.length)
		return config.web ? [webFrameworks.label(config.web)] : [];

	return webAppInstances(config).map(
		(app) => `${app.key} (${webFrameworks.label(app.framework)})`,
	);
}

export function webClientEnvMessage(config: ForgeConfig): string {
	const clientNames = webAppInstances(config)
		.filter((instance) => instance.client === true)
		.map((instance) => instance.key);

	if (clientNames.length === 0)
		return "Remove WEB_URLS from .env: no secondary web app calls the API now.";

	return `Set WEB_URLS="${secondaryClientOrigins(config).join(",")}" in .env so ${listAnd.format(clientNames)} can call the API.`;
}
