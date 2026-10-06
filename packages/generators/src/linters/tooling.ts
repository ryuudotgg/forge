import type { PackageManagerId } from "@ryuugg/core";
import type { ForgeConfig } from "../config";
import { biomeTooling } from "./biome";
import { oxcTooling } from "./oxc";

export interface LinterTooling {
	readonly scripts: { readonly check: string; readonly "check:fix": string };
	readonly preCommit: (pm: PackageManagerId) => ReadonlyArray<string>;
	readonly editor: {
		readonly extension: string;
		readonly formatter: string;
		readonly fixAllAction: string;
		readonly proseOverrides: Readonly<Record<string, string>>;
	};
}

export function toolingFor(config: ForgeConfig): LinterTooling | undefined {
	switch (config.linter) {
		case "biome":
			return biomeTooling;

		case "oxc":
			return oxcTooling;

		case "eslint-prettier":
		case undefined:
			return undefined;

		default: {
			const unhandled: never = config.linter;
			return unhandled;
		}
	}
}
