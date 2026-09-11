import type { ForgeConfig } from "../config";
import { resolvePackageManager } from "../pm";

const lightningcssReactNativeCssCompiles = "1.30.1";
const effectCoreLastPublished = "4.0.0-rc.113";

export function packageOverrides(
	config: ForgeConfig,
): Readonly<Record<string, string>> {
	const overrides: Record<string, string> = {};

	if (config.mobile === "expo" && config.nativeStyleFramework === "nativewind")
		overrides.lightningcss = lightningcssReactNativeCssCompiles;

	if (config.orm === "drizzle" && resolvePackageManager(config) === "npm")
		overrides.effect = effectCoreLastPublished;

	return overrides;
}
