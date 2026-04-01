export type { ForgeConfig } from "./config";

export { default as biome } from "./linters/biome";
export { default as gitignore } from "./tooling/gitignore";
export { default as typescript } from "./tooling/typescript";
export { default as pnpm } from "./workspace/pnpm";
export { default as root } from "./workspace/root";

import type { Generator } from "@ryuujs/core";
import type { ForgeConfig } from "./config";
import biome from "./linters/biome";
import gitignore from "./tooling/gitignore";
import typescript from "./tooling/typescript";
import pnpm from "./workspace/pnpm";
import root from "./workspace/root";

export const generators: ReadonlyArray<Generator<ForgeConfig>> = [
	root,
	pnpm,
	typescript,
	biome,
	gitignore,
];
