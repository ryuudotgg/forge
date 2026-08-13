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

const mixedAddon = defineAddon<ForgeConfig>({
	id: "@fixture/mixed",
	name: "Fixture Mixed Support",
	version: "1.0.0",
	category: "addon",
	exclusive: false,
	targetMode: "multiple",
	compatibility: { app: { frameworks: ["nextjs"] } },
	when: () => false,
	contribute: () => [],
});

const unconstrainedAddon = defineAddon<ForgeConfig>({
	id: "@fixture/unconstrained",
	name: "Fixture Unconstrained Support",
	version: "1.0.0",
	category: "addon",
	exclusive: false,
	targetMode: "multiple",
	compatibility: { app: {} },
	when: () => false,
	contribute: () => [],
});

const adapter = defineAdapter<ForgeConfig>({
	addon: "vitest",
	framework: "nextjs",
	contribute: () => [],
});

const mixedAdapter = defineAdapter<ForgeConfig>({
	addon: "@fixture/mixed",
	framework: "@fixture/web",
	contribute: () => [],
});

const unconstrainedAdapter = defineAdapter<ForgeConfig>({
	addon: "@fixture/unconstrained",
	framework: "@fixture/web",
	contribute: () => [],
});

const framework = defineFramework({
	id: "@fixture/web",
	buildOutputs: ["dist/**"],
	configFile: "fixture.config.ts",
	ignoreDirs: ["dist/"],
	name: "Fixture Web",
	sourceRoot: "",
	slots: ["page"],
	tsconfigPreset: { content: {}, name: "fixture" },
});

const template = defineTemplate<ForgeConfig>({
	id: "@fixture/base",
	framework: "@fixture/web",
	name: "Fixture Base",
	version: 1,
	category: "web",
	when: () => false,
	contribute: () => [],
});

const registry = {
	apiVersion: authoringApiVersion,
	addons: [addon, mixedAddon, unconstrainedAddon],
	adapters: [adapter, mixedAdapter, unconstrainedAdapter],
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
			category: "addon",
			description: "An addon with unconstrained declared app support.",
			experimental: false,
			hidden: false,
			id: "@fixture/unconstrained",
			keywords: ["fixture"],
			kind: "addon",
			name: "Fixture Unconstrained Support",
			summary: "Exercise unconstrained app support derivation.",
			targetMode: "multiple",
		},
		{
			available: true,
			category: "addon",
			description: "An addon with declared and adapter-derived support.",
			experimental: false,
			hidden: false,
			id: "@fixture/mixed",
			keywords: ["fixture"],
			kind: "addon",
			name: "Fixture Mixed Support",
			summary: "Exercise support union derivation.",
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
