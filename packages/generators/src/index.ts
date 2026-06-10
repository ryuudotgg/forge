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
	addonConfigBindings,
	authenticationProviders,
	backends,
	catalogs,
	configWithInstall,
	configWithoutInstall,
	databaseProviders,
	databases,
	desktopFrameworks,
	hasAddon,
	installConflict,
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
	PrismaSupport,
	ProviderEnvVar,
} from "./data/providers";
export {
	detectDatabaseProvider,
	localPostgres,
	postgresProviderIds,
	postgresProviderIdsFor,
	resolveDatabaseProvider,
} from "./data/providers";
export { default as nextjs, nextjsFramework } from "./frameworks/nextjs";
export { default as biome } from "./linters/biome";
export { default as drizzle } from "./orm/drizzle";
export { default as prisma } from "./orm/prisma";
export {
	builtins,
	findRemovalBlockers,
	loadAddonDefinition,
	loadDefinitionRegistry,
	RegistryLoadError,
	resolveBuiltins,
} from "./registry";
export type { RemovalBlockers } from "./registry/loader";
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
