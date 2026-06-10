export { default as trpc } from "./api/trpc";
export { default as betterAuth } from "./auth/better-auth";
export type {
	AddonCatalogEntry,
	CatalogEntry,
	CatalogKind,
	FrameworkCatalogEntry,
	TemplateCatalogEntry,
} from "./catalog";
export {
	catalog,
	getCatalogEntry,
	listCatalogEntries,
	listVisibleAddons,
} from "./catalog";
export type {
	AuthenticationProvider,
	Backend,
	Catalogs,
	Database,
	DatabaseProvider,
	DesktopFramework,
	ForgeConfig,
	Linter,
	MobileFramework,
	NativeStyleFramework,
	OptionalAddon,
	Orm,
	Platform,
	RpcProvider,
	StyleFramework,
	UiLibrary,
	WebFramework,
} from "./config";
export {
	authenticationProviders,
	backends,
	catalogs,
	databaseProviders,
	databases,
	desktopFrameworks,
	hasAddon,
	linters,
	mobileFrameworks,
	nativeStyleFrameworks,
	optionalAddons,
	orms,
	platforms,
	recommendedAddons,
	rpcProviders,
	styleFrameworks,
	uiLibraries,
	webFrameworks,
	withAddon,
	withoutAddon,
} from "./config";
export type {
	DatabaseProviderProfile,
	DrizzleDriver,
	DrizzleSupport,
	ProviderEnvVar,
} from "./data/providers";
export {
	detectDatabaseProvider,
	localPostgres,
	postgresProviderIds,
	resolveDatabaseProvider,
} from "./data/providers";
export { default as nextjs, nextjsFramework } from "./frameworks/nextjs";
export { default as biome } from "./linters/biome";
export { default as drizzle } from "./orm/drizzle";
export {
	builtins,
	loadAddonDefinition,
	loadDefinitionRegistry,
	RegistryLoadError,
	resolveBuiltins,
} from "./registry";
export type {
	LoadedAddonDefinition,
	LoadedDefinitionRegistry,
} from "./registry/types";
export { default as shared } from "./shared";
export { default as tailwind } from "./style/tailwind";
export { default as gitignore } from "./tooling/gitignore";
export { default as typescript } from "./tooling/typescript";
export { default as ui } from "./ui";
export { default as pnpm } from "./workspace/pnpm";
export { default as root } from "./workspace/root";
export { default as yarn } from "./workspace/yarn";
