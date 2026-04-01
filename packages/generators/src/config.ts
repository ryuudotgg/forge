export interface ForgeConfig {
	readonly [key: string]: unknown;
	readonly name?: string;
	readonly slug?: string;
	readonly path?: string;
	readonly runtime?: string;
	readonly packageManager?: string;
	readonly catalogs?: string;
	readonly linter?: string;
	readonly platforms?: ReadonlyArray<string>;
	readonly web?: string;
	readonly desktop?: string;
	readonly mobile?: string;
}
