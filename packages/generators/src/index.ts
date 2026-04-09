export { default as trpc } from "./api/trpc";
export { default as betterAuth } from "./auth/better-auth";
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
export { default as tailwind } from "./style/tailwind";
export { default as gitignore } from "./tooling/gitignore";
export { default as typescript } from "./tooling/typescript";
export { default as ui } from "./ui";
export { default as pnpm } from "./workspace/pnpm";
export { default as root } from "./workspace/root";

import { defineRegistry, resolveDefinitions } from "@ryuujs/core";
import trpc from "./api/trpc";
import betterAuth from "./auth/better-auth";
import type { ForgeConfig } from "./config";
import nextjsBaseTemplate, { nextjsFramework } from "./frameworks/nextjs";
import biome from "./linters/biome";
import drizzle from "./orm/drizzle";
import tailwind from "./style/tailwind";
import gitignore from "./tooling/gitignore";
import typescript from "./tooling/typescript";
import ui from "./ui";
import pnpm from "./workspace/pnpm";
import root from "./workspace/root";

export const builtins = defineRegistry<ForgeConfig>({
	frameworks: [nextjsFramework],
	templates: [nextjsBaseTemplate],
	addons: [
		root,
		pnpm,
		typescript,
		biome,
		gitignore,
		ui,
		tailwind,
		trpc,
		drizzle,
		betterAuth,
	],
});

export function resolveBuiltins(config: ForgeConfig) {
	return resolveDefinitions(config, builtins);
}
