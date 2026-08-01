import {
	authoringApiVersion,
	defineAdapter,
	defineAddon,
	defineFramework,
	defineTemplate,
} from "@ryuujs/core";
import type { ForgeConfig, RegistryPackageManifest } from "../../../src";

const addon = defineAddon<ForgeConfig>({
	id: "@fixture/neutral",
	name: "Fixture Neutral",
	version: "1.0.0",
	category: "addon",
	exclusive: false,
	targetMode: "multiple",
	when: () => false,
	contribute: () => [],
});

const adapter = defineAdapter<ForgeConfig>({
	addon: "vitest",
	framework: "nextjs",
	contribute: () => [],
});

const framework = defineFramework({
	id: "@fixture/web",
	buildOutputs: ["dist/**"],
	configFile: "fixture.config.ts",
	ignoreDirs: ["dist/"],
	name: "Fixture Web",
	slots: ["page"],
	tsconfigPreset: { content: {}, name: "fixture" },
});

const template = defineTemplate<ForgeConfig>({
	id: "@fixture/base",
	framework: "@fixture/web",
	name: "Fixture Base",
	version: 1,
	category: "web",
	exclusive: true,
	when: () => false,
	contribute: () => [],
});

const registry = {
	apiVersion: authoringApiVersion,
	addons: [addon],
	adapters: [adapter],
	frameworks: [framework],
	templates: [template],
	catalog: [
		{
			available: true,
			category: "addon",
			description: "A neutral fixture addon.",
			experimental: false,
			hidden: false,
			id: "@fixture/neutral",
			keywords: ["fixture"],
			kind: "addon",
			name: "Fixture Neutral",
			summary: "Exercise third-party addon loading.",
			targetMode: "multiple",
		},
		{
			available: true,
			category: "web",
			description: "A fixture framework.",
			experimental: false,
			hidden: false,
			id: "@fixture/web",
			keywords: ["fixture"],
			kind: "framework",
			name: "Fixture Web",
			slots: ["page"],
			summary: "Exercise third-party framework loading.",
		},
		{
			available: true,
			category: "web",
			description: "A fixture template.",
			experimental: false,
			framework: "@fixture/web",
			hidden: false,
			id: "@fixture/base",
			keywords: ["fixture"],
			kind: "template",
			name: "Fixture Base",
			summary: "Exercise third-party template loading.",
			version: 1,
		},
	],
} satisfies RegistryPackageManifest<ForgeConfig>;

export default registry;
