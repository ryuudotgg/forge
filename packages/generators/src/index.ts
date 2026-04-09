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
	Orm,
	Platform,
	RpcProvider,
	StyleFramework,
	WebFramework,
} from "./config";
export {
	authenticationProviders,
	backends,
	catalogs,
	databaseProviders,
	databases,
	desktopFrameworks,
	linters,
	mobileFrameworks,
	nativeStyleFrameworks,
	orms,
	platforms,
	rpcProviders,
	styleFrameworks,
	webFrameworks,
} from "./config";
export { default as nextjs, nextjsFramework } from "./frameworks/nextjs";
export { default as biome } from "./linters/biome";
export { default as drizzle } from "./orm/drizzle";
export { builtins, resolveBuiltins } from "./registry";
export { default as tailwind } from "./style/tailwind";
export { default as gitignore } from "./tooling/gitignore";
export { default as typescript } from "./tooling/typescript";
export { default as ui } from "./ui";
export { default as pnpm } from "./workspace/pnpm";
export { default as root } from "./workspace/root";
