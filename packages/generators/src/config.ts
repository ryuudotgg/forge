import type { PackageManager, Runtime } from "@ryuujs/core";

export interface ForgeConfig {
	readonly [key: string]: unknown;
	readonly name?: string;
	readonly slug?: string;
	readonly path?: string;
	readonly runtime?: Runtime;
	readonly packageManager?: PackageManager;
	readonly catalogs?: string;
	readonly linter?: string;
	readonly platforms?: ReadonlyArray<string>;
	readonly web?: string;
	readonly style?: string;
	readonly api?: string;
	readonly orm?: string;
	readonly auth?: string;
	readonly database?: string;
	readonly desktop?: string;
	readonly mobile?: string;
}
