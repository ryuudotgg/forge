import {
	type ForgeConfig,
	webAppInstances,
	webFrameworks,
} from "@ryuugg/generators";

export function webAppLabels(config: ForgeConfig): string[] {
	if (!config.webApps?.length)
		return config.web ? [webFrameworks.label(config.web)] : [];

	return webAppInstances(config).map(
		(app) => `${app.key} (${webFrameworks.label(app.framework)})`,
	);
}
