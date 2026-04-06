export { default as trpc } from "./api/trpc";
export { default as betterAuth } from "./auth/better-auth";
export type { ForgeConfig } from "./config";
export { default as nextjs } from "./frameworks/nextjs";
export { default as biome } from "./linters/biome";
export { default as drizzle } from "./orm/drizzle";
export { default as tailwind } from "./style/tailwind";
export { default as gitignore } from "./tooling/gitignore";
export { default as typescript } from "./tooling/typescript";
export { default as ui } from "./ui";
export { default as pnpm } from "./workspace/pnpm";
export { default as root } from "./workspace/root";

import type { Generator } from "@ryuujs/core";
import trpc from "./api/trpc";
import betterAuth from "./auth/better-auth";
import type { ForgeConfig } from "./config";
import nextjs from "./frameworks/nextjs";
import biome from "./linters/biome";
import drizzle from "./orm/drizzle";
import tailwind from "./style/tailwind";
import gitignore from "./tooling/gitignore";
import typescript from "./tooling/typescript";
import ui from "./ui";
import pnpm from "./workspace/pnpm";
import root from "./workspace/root";

export const generators: ReadonlyArray<Generator<ForgeConfig>> = [
	root,
	pnpm,
	typescript,
	biome,
	gitignore,
	ui,
	nextjs,
	tailwind,
	trpc,
	drizzle,
	betterAuth,
];
