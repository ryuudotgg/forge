import { defineRegistry } from "@ryuujs/core";
import trpc, { trpcMetadata } from "../api/trpc";
import { trpcAdapters, trpcRecipe } from "../api/trpc/recipe";
import betterAuth, { betterAuthMetadata } from "../auth/better-auth";
import {
	betterAuthAdapters,
	betterAuthRecipe,
} from "../auth/better-auth/recipe";
import {
	authenticationProviders,
	type ForgeConfig,
	linters,
	styleFrameworks,
	webFrameworks,
} from "../config";
import nextjsBaseTemplate, {
	nextjsBaseTemplateMetadata,
	nextjsFramework,
	nextjsFrameworkMetadata,
} from "../frameworks/nextjs";
import reactRouterBaseTemplate, {
	reactRouterBaseTemplateMetadata,
	reactRouterFramework,
	reactRouterFrameworkMetadata,
} from "../frameworks/react-router";
import tanstackRouterBaseTemplate, {
	tanstackRouterBaseTemplateMetadata,
	tanstackRouterFramework,
	tanstackRouterFrameworkMetadata,
} from "../frameworks/tanstack-router";
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
import { readTemplate } from "../template";
import commitlint, { commitlintMetadata } from "../tooling/commitlint";
import githubCi, { githubCiMetadata } from "../tooling/github-ci";
import gitignore, { gitignoreMetadata } from "../tooling/gitignore";
import lefthook, { lefthookMetadata } from "../tooling/lefthook";
import typescript, { typescriptMetadata } from "../tooling/typescript";
import vitest, { vitestMetadata } from "../tooling/vitest";
import vscode, { vscodeMetadata } from "../tooling/vscode";
import ui, { uiMetadata } from "../ui";
import { uiAdapters, uiRecipe } from "../ui/recipe";
import bun, { bunMetadata } from "../workspace/bun";
import pnpm, { pnpmMetadata } from "../workspace/pnpm";
import root, { rootMetadata } from "../workspace/root";
import yarn, { yarnMetadata } from "../workspace/yarn";
import {
	addonCatalogEntry,
	announcedCatalogEntry,
	type CatalogEntry,
	frameworkCatalogEntry,
	templateCatalogEntry,
} from "./types";

export const firstPartyRegistry = defineRegistry<ForgeConfig>({
	adapters: [...trpcAdapters, ...betterAuthAdapters, ...uiAdapters],
	frameworks: [
		nextjsFramework,
		reactRouterFramework,
		tanstackRouterFramework,
		tanstackStartFramework,
	],
	templates: [
		nextjsBaseTemplate,
		reactRouterBaseTemplate,
		tanstackRouterBaseTemplate,
		tanstackStartBaseTemplate,
	],
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
	recipes: [trpcRecipe, betterAuthRecipe, uiRecipe],
	readTemplate,
});

export const firstPartyCatalog = [
	frameworkCatalogEntry(nextjsFramework, nextjsFrameworkMetadata),
	templateCatalogEntry(nextjsBaseTemplate, nextjsBaseTemplateMetadata),
	frameworkCatalogEntry(reactRouterFramework, reactRouterFrameworkMetadata),
	templateCatalogEntry(
		reactRouterBaseTemplate,
		reactRouterBaseTemplateMetadata,
	),
	frameworkCatalogEntry(
		tanstackRouterFramework,
		tanstackRouterFrameworkMetadata,
	),
	templateCatalogEntry(
		tanstackRouterBaseTemplate,
		tanstackRouterBaseTemplateMetadata,
	),
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
	...webFrameworks.ids
		.filter((id) => !webFrameworks.available(id))
		.map((id) =>
			announcedCatalogEntry("framework", id, webFrameworks.label(id)),
		),
	...authenticationProviders.ids
		.filter((id) => !authenticationProviders.available(id))
		.map((id) =>
			announcedCatalogEntry(
				"addon",
				id,
				authenticationProviders.label(id),
				"auth",
			),
		),
	...styleFrameworks.ids
		.filter((id) => !styleFrameworks.available(id))
		.map((id) =>
			announcedCatalogEntry("addon", id, styleFrameworks.label(id), "style"),
		),
	...linters.ids
		.filter((id) => !linters.available(id))
		.map((id) =>
			announcedCatalogEntry("addon", id, linters.label(id), "linter"),
		),
] as const satisfies ReadonlyArray<CatalogEntry>;
