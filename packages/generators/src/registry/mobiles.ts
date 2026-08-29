import type { FrameworkDefinition } from "@ryuujs/core";
import type { ForgeConfig } from "../config";
import { expoFramework } from "../frameworks/expo";

export const mobileAppFrameworks: ReadonlyArray<FrameworkDefinition> = [
	expoFramework,
];

export const mobileAppFrameworkIds: ReadonlySet<string> = new Set(
	mobileAppFrameworks.map((framework) => framework.id),
);

export function mobileAppFrameworkInPlay(
	config: ForgeConfig,
): string | undefined {
	return config.mobile !== undefined && mobileAppFrameworkIds.has(config.mobile)
		? config.mobile
		: undefined;
}
