import { defineAdapter, defineAddon } from "@ryuujs/core";
import {
	type ForgeConfig,
	loadDefinitionRegistry,
	type RegistryPackageManifest,
} from "@ryuujs/generators";

export const fixtureRegistryId = "@acme/forge-sentry";

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

export function loadDiscoveryFixture() {
	return loadDefinitionRegistry({
		importRegistry: async () => ({
			module: { default: manifest },
			version: "1.4.2",
		}),
		projectRoot: "/fixture-project",
		registries: [fixtureRegistryId],
	});
}
