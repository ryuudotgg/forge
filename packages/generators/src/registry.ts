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
