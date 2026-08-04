import type { ApplyOptions, ResolutionPolicy } from "@ryuujs/core";

export type ResolutionArguments = [] | [ApplyOptions];

export function resolutionArguments(
	values: Readonly<Record<string, string | boolean | undefined>>,
): ResolutionArguments {
	let resolutionPolicy: ResolutionPolicy = "refuse";
	if (values["keep-user"] === true) resolutionPolicy = "keep-user";
	if (values["accept-forge"] === true) resolutionPolicy = "accept-forge";

	return resolutionPolicy === "refuse" ? [] : [{ resolutionPolicy }];
}
