import { defineRegistry, resolveDefinitions } from "@ryuujs/core";
import trpc, { trpcMetadata } from "../api/trpc";
import betterAuth, { betterAuthMetadata } from "../auth/better-auth";
import type { ForgeConfig } from "../config";
import nextjsBaseTemplate, {
	nextjsBaseTemplateMetadata,
	nextjsFramework,
	nextjsFrameworkMetadata,
} from "../frameworks/nextjs";
import tanstackStartBaseTemplate, {
	tanstackStartBaseTemplateMetadata,
	tanstackStartFramework,
	tanstackStartFrameworkMetadata,
} from "../frameworks/tanstack-start";
import biome, { biomeMetadata } from "../linters/biome";
import drizzle, { drizzleMetadata } from "../orm/drizzle";
import prisma, { prismaMetadata } from "../orm/prisma";
import shared, { sharedMetadata } from "../shared";
import tailwind, { tailwindMetadata } from "../style/tailwind";
import commitlint, { commitlintMetadata } from "../tooling/commitlint";
import githubCi, { githubCiMetadata } from "../tooling/github-ci";
import gitignore, { gitignoreMetadata } from "../tooling/gitignore";
import lefthook, { lefthookMetadata } from "../tooling/lefthook";
import typescript, { typescriptMetadata } from "../tooling/typescript";
import vitest, { vitestMetadata } from "../tooling/vitest";
import vscode, { vscodeMetadata } from "../tooling/vscode";
import ui, { uiMetadata } from "../ui";
import bun, { bunMetadata } from "../workspace/bun";
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
	frameworks: [nextjsFramework, tanstackStartFramework],
	templates: [nextjsBaseTemplate, tanstackStartBaseTemplate],
	addons: [
		root,
		pnpm,
		yarn,
		bun,
		typescript,
		biome,
		gitignore,
		commitlint,
		lefthook,
		vitest,
		vscode,
		githubCi,
		shared,
		ui,
		tailwind,
		trpc,
		drizzle,
		prisma,
		betterAuth,
	],
});

export const firstPartyCatalog = [
	frameworkCatalogEntry(nextjsFramework, nextjsFrameworkMetadata),
	templateCatalogEntry(nextjsBaseTemplate, nextjsBaseTemplateMetadata),
	frameworkCatalogEntry(tanstackStartFramework, tanstackStartFrameworkMetadata),
	templateCatalogEntry(
		tanstackStartBaseTemplate,
		tanstackStartBaseTemplateMetadata,
	),
	addonCatalogEntry(root, rootMetadata),
	addonCatalogEntry(pnpm, pnpmMetadata),
	addonCatalogEntry(yarn, yarnMetadata),
	addonCatalogEntry(bun, bunMetadata),
	addonCatalogEntry(typescript, typescriptMetadata),
	addonCatalogEntry(biome, biomeMetadata),
	addonCatalogEntry(gitignore, gitignoreMetadata),
	addonCatalogEntry(commitlint, commitlintMetadata),
	addonCatalogEntry(lefthook, lefthookMetadata),
	addonCatalogEntry(vitest, vitestMetadata),
	addonCatalogEntry(vscode, vscodeMetadata),
	addonCatalogEntry(githubCi, githubCiMetadata),
	addonCatalogEntry(shared, sharedMetadata),
	addonCatalogEntry(ui, uiMetadata),
	addonCatalogEntry(tailwind, tailwindMetadata),
	addonCatalogEntry(trpc, trpcMetadata),
	addonCatalogEntry(drizzle, drizzleMetadata),
	addonCatalogEntry(prisma, prismaMetadata),
	addonCatalogEntry(betterAuth, betterAuthMetadata),
] as const satisfies ReadonlyArray<CatalogEntry>;

export function resolveFirstPartyDefinitions(config: ForgeConfig) {
	return resolveDefinitions(config, firstPartyRegistry);
}
