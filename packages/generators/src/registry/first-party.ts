import { defineRegistry, resolveDefinitions } from "@ryuujs/core";
import trpc, { trpcMetadata } from "../api/trpc";
import betterAuth, { betterAuthMetadata } from "../auth/better-auth";
import type { ForgeConfig } from "../config";
import nextjsBaseTemplate, {
	nextjsBaseTemplateMetadata,
	nextjsFramework,
	nextjsFrameworkMetadata,
} from "../frameworks/nextjs";
import biome, { biomeMetadata } from "../linters/biome";
import drizzle, { drizzleMetadata } from "../orm/drizzle";
import tailwind, { tailwindMetadata } from "../style/tailwind";
import commitlint, { commitlintMetadata } from "../tooling/commitlint";
import githubCi, { githubCiMetadata } from "../tooling/github-ci";
import gitignore, { gitignoreMetadata } from "../tooling/gitignore";
import lefthook, { lefthookMetadata } from "../tooling/lefthook";
import typescript, { typescriptMetadata } from "../tooling/typescript";
import vscode, { vscodeMetadata } from "../tooling/vscode";
import ui, { uiMetadata } from "../ui";
import pnpm, { pnpmMetadata } from "../workspace/pnpm";
import root, { rootMetadata } from "../workspace/root";
import yarn, { yarnMetadata } from "../workspace/yarn";
import {
	addonCatalogEntry,
	type CatalogEntry,
	frameworkCatalogEntry,
	templateCatalogEntry,
} from "./types";

export const firstPartyRegistry = defineRegistry<ForgeConfig>({
	frameworks: [nextjsFramework],
	templates: [nextjsBaseTemplate],
	addons: [
		root,
		pnpm,
		yarn,
		typescript,
		biome,
		gitignore,
		commitlint,
		lefthook,
		vscode,
		githubCi,
		ui,
		tailwind,
		trpc,
		drizzle,
		betterAuth,
	],
});

export const firstPartyCatalog = [
	frameworkCatalogEntry(nextjsFramework, nextjsFrameworkMetadata),
	templateCatalogEntry(nextjsBaseTemplate, nextjsBaseTemplateMetadata),
	addonCatalogEntry(root, rootMetadata),
	addonCatalogEntry(pnpm, pnpmMetadata),
	addonCatalogEntry(yarn, yarnMetadata),
	addonCatalogEntry(typescript, typescriptMetadata),
	addonCatalogEntry(biome, biomeMetadata),
	addonCatalogEntry(gitignore, gitignoreMetadata),
	addonCatalogEntry(commitlint, commitlintMetadata),
	addonCatalogEntry(lefthook, lefthookMetadata),
	addonCatalogEntry(vscode, vscodeMetadata),
	addonCatalogEntry(githubCi, githubCiMetadata),
	addonCatalogEntry(ui, uiMetadata),
	addonCatalogEntry(tailwind, tailwindMetadata),
	addonCatalogEntry(trpc, trpcMetadata),
	addonCatalogEntry(drizzle, drizzleMetadata),
	addonCatalogEntry(betterAuth, betterAuthMetadata),
] as const satisfies ReadonlyArray<CatalogEntry>;

export function resolveFirstPartyDefinitions(config: ForgeConfig) {
	return resolveDefinitions(config, firstPartyRegistry);
}
