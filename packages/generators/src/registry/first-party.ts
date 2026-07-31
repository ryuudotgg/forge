import { defineRegistry } from "@ryuujs/core";
import trpc, { trpcMetadata } from "../api/trpc";
import { trpcNextjsAdapter } from "../api/trpc/adapters/nextjs";
import { trpcTanstackStartAdapter } from "../api/trpc/adapters/tanstack-start";
import betterAuth, { betterAuthMetadata } from "../auth/better-auth";
import { betterAuthNextjsAdapter } from "../auth/better-auth/adapters/nextjs";
import { betterAuthTanstackStartAdapter } from "../auth/better-auth/adapters/tanstack-start";
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
import { uiNextjsAdapter } from "../ui/adapters/nextjs";
import { uiTanstackStartAdapter } from "../ui/adapters/tanstack-start";
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
	adapters: [
		trpcNextjsAdapter,
		trpcTanstackStartAdapter,
		betterAuthNextjsAdapter,
		betterAuthTanstackStartAdapter,
		uiNextjsAdapter,
		uiTanstackStartAdapter,
	],
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
	addonCatalogEntry(root, rootMetadata, firstPartyRegistry.adapters),
	addonCatalogEntry(pnpm, pnpmMetadata, firstPartyRegistry.adapters),
	addonCatalogEntry(yarn, yarnMetadata, firstPartyRegistry.adapters),
	addonCatalogEntry(bun, bunMetadata, firstPartyRegistry.adapters),
	addonCatalogEntry(
		typescript,
		typescriptMetadata,
		firstPartyRegistry.adapters,
	),
	addonCatalogEntry(biome, biomeMetadata, firstPartyRegistry.adapters),
	addonCatalogEntry(gitignore, gitignoreMetadata, firstPartyRegistry.adapters),
	addonCatalogEntry(
		commitlint,
		commitlintMetadata,
		firstPartyRegistry.adapters,
	),
	addonCatalogEntry(lefthook, lefthookMetadata, firstPartyRegistry.adapters),
	addonCatalogEntry(vitest, vitestMetadata, firstPartyRegistry.adapters),
	addonCatalogEntry(vscode, vscodeMetadata, firstPartyRegistry.adapters),
	addonCatalogEntry(githubCi, githubCiMetadata, firstPartyRegistry.adapters),
	addonCatalogEntry(shared, sharedMetadata, firstPartyRegistry.adapters),
	addonCatalogEntry(ui, uiMetadata, firstPartyRegistry.adapters),
	addonCatalogEntry(tailwind, tailwindMetadata, firstPartyRegistry.adapters),
	addonCatalogEntry(trpc, trpcMetadata, firstPartyRegistry.adapters),
	addonCatalogEntry(drizzle, drizzleMetadata, firstPartyRegistry.adapters),
	addonCatalogEntry(prisma, prismaMetadata, firstPartyRegistry.adapters),
	addonCatalogEntry(
		betterAuth,
		betterAuthMetadata,
		firstPartyRegistry.adapters,
	),
] as const satisfies ReadonlyArray<CatalogEntry>;
