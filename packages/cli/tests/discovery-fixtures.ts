import { defineAdapter, defineAddon, defineFramework } from "@ryuujs/core";
import {
	type ForgeConfig,
	loadDefinitionRegistry,
	type RegistryPackageManifest,
} from "@ryuujs/generators";

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
