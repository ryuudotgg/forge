import { join } from "node:path";
import {
	defineAdapter,
	defineAddon,
	defineFramework,
	type Manifest,
} from "@ryuujs/core";
import {
	type ForgeConfig,
	loadDefinitionRegistry,
	type RegistryPackageManifest,
} from "@ryuujs/generators";
import { loadDiscoveryRegistry } from "../src/commands/lifecycle";
import { writeJson } from "./lifecycle-fixtures";

export const fixtureRegistryId = "@acme/forge-sentry";
export const adapterFixtureRegistryId = "@solid/forge-sentry";

const sentry = defineAddon<ForgeConfig>({
	category: "tooling",
	compatibility: { app: { frameworks: ["nextjs"] } },
	contribute: () => [],
	dependencies: [],
	exclusive: false,
	id: "@acme/sentry",
	name: "Sentry",
	targetMode: "multiple",
	version: "1.0.0",
	when: () => false,
});

const vitestTanstackStartAdapter = defineAdapter<ForgeConfig>({
	addon: "vitest",
	contribute: () => [],
	framework: "tanstack-start",
});

const solid = defineFramework({
	buildOutputs: ["dist/**"],
	configFile: "vite.config.ts",
	id: "@solid/web",
	ignoreDirs: ["dist/"],
	name: "Solid",
	sourceRoot: "",
	slots: ["app"],
	tsconfigPreset: { content: {}, name: "solid" },
});

const sentrySolidAdapter = defineAdapter<ForgeConfig>({
	addon: "@acme/sentry",
	contribute: () => [],
	framework: "@solid/web",
});

const sentryNextjsAdapter = defineAdapter<ForgeConfig>({
	addon: "@acme/sentry",
	contribute: () => [],
	framework: "nextjs",
});

const manifest = {
	adapters: [vitestTanstackStartAdapter],
	addons: [sentry],
	apiVersion: 1,
	catalog: [
		{
			available: true,
			category: "tooling",
			description:
				"Adds Sentry observability to compatible Forge application targets.",
			experimental: false,
			hidden: false,
			id: "@acme/sentry",
			keywords: ["errors", "monitoring", "sentry"],
			kind: "addon",
			name: "Sentry",
			summary: "Add Sentry observability.",
			targetMode: "multiple",
		},
	],
} satisfies RegistryPackageManifest<ForgeConfig>;

const adapterManifest = {
	adapters: [sentrySolidAdapter, sentryNextjsAdapter],
	apiVersion: 1,
	catalog: [
		{
			available: true,
			category: "web",
			description: "A Solid framework fixture.",
			experimental: false,
			hidden: false,
			id: "@solid/web",
			keywords: ["solid"],
			kind: "framework",
			name: "Solid",
			slots: ["app"],
			summary: "Exercise cross-publisher adapter support.",
		},
	],
	frameworks: [solid],
} satisfies RegistryPackageManifest<ForgeConfig>;

export function loadDiscoveryFixture() {
	return loadDefinitionRegistry({
		importRegistry: async (registryId) =>
			registryId === adapterFixtureRegistryId
				? {
						module: { default: adapterManifest },
						version: "2.1.0",
					}
				: {
						module: { default: manifest },
						version: "1.4.2",
					},
		projectRoot: "/fixture-project",
		registries: [fixtureRegistryId, adapterFixtureRegistryId],
	});
}

export async function loadAdoptedDiscoveryFixture(directory: string) {
	const manifest = {
		config: {
			database: "sqlite",
			orm: "drizzle",
			packageManager: "pnpm",
			slug: "acme",
		},
		installs: [
			{
				definitionId: "drizzle",
				targets: [{ kind: "module", moduleId: "abcde" }],
				versions: [
					{
						name: "drizzle-orm",
						root: "packages/db",
						section: "dependencies",
						specifier: "1.0.0-rc.4",
						version: "1.0.0-rc.4",
					},
					{
						name: "drizzle-kit",
						root: "packages/db",
						section: "devDependencies",
						specifier: "0.31.0",
						version: "0.31.0",
					},
					{
						name: "postgres",
						root: "packages/db",
						section: "dependencies",
						specifier: "3.4.7",
						version: "3.4.7",
					},
				],
			},
		],
		modules: {
			abcde: {
				definitionIds: ["drizzle"],
				root: "packages/db",
			},
		},
		schemaVersion: 1,
	} satisfies Manifest;

	await writeJson(join(directory, ".forge/manifest.json"), manifest);

	return loadDiscoveryRegistry(directory);
}
