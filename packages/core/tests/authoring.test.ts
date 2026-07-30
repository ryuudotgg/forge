import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import {
	type AddonDefinition,
	type AppConfig,
	type Compatibility,
	defineAddon,
	defineFramework,
	defineTemplate,
	ensuredModuleTarget,
	GeneratorError,
	isAddonCompatibleWithModule,
	type PackageConfig,
	resolveSlotPath,
	SlotPathError,
	slotPath,
	validateAddonAgainstSelection,
} from "../src/index";

interface TestConfig {
	readonly style?: "tailwind";
	readonly web?: "nextjs";
}

const framework = defineFramework({
	id: "nextjs",
	configFile: "next.config.ts",
	buildOutputs: [".next/**", "!.next/cache/**"],
	ignoreDirs: [".next/"],
	name: "Next.js",
	slots: ["layout", "page"],
	tsconfigPreset: { content: {}, name: "nextjs" },
});

const template = defineTemplate<TestConfig>({
	id: "nextjs/base",
	framework: "nextjs",
	name: "Base",
	version: 1,
	category: "web",
	exclusive: true,
	when: (config) => config.web === "nextjs",
	contribute: () => [],
});

function compatibilityAddon(
	compatibility: Compatibility,
): AddonDefinition<TestConfig> {
	return defineAddon<TestConfig>({
		id: "tailwind",
		name: "Tailwind CSS",
		version: "0.1.0",
		category: "style",
		exclusive: true,
		targetMode: "single",
		compatibility,
		when: (config) => config.style === "tailwind",
		contribute: () => [],
	});
}

function resolveFailure(
	addon: AddonDefinition<TestConfig>,
	config: TestConfig = { style: "tailwind", web: "nextjs" },
): Promise<GeneratorError> {
	return Effect.runPromise(
		Effect.flip(
			validateAddonAgainstSelection(
				addon,
				config.web === "nextjs" ? framework : undefined,
				config.web === "nextjs" ? template : undefined,
			),
		),
	);
}

const appAddon = compatibilityAddon({
	app: {
		frameworks: ["nextjs"],
		requiredSlots: ["layout"],
		templates: [{ id: "nextjs/base", version: 1 }],
	},
});

const packageAddon = defineAddon<TestConfig>({
	id: "theme-tools",
	name: "Theme Tools",
	version: "0.1.0",
	category: "addon",
	exclusive: false,
	targetMode: "multiple",
	compatibility: {
		package: {
			capabilities: ["react", "ui"],
			requiredSlots: ["utils"],
		},
	},
	when: () => false,
	contribute: () => [],
});

const appModule: AppConfig = {
	id: "abcde",
	type: "app",
	framework: "nextjs",
	template: { id: "base", version: 1 },
	slots: { layout: "app/layout.tsx" },
};

const packageModule: PackageConfig = {
	id: "fghij",
	type: "package",
	packageType: "library",
	template: { id: "ui", version: 1 },
	capabilities: ["react", "ui"],
	slots: { utils: "src/lib/utils.ts" },
};

describe("authoring", () => {
	it("resolves a filled app slot path", async () => {
		const web = ensuredModuleTarget("web");
		const resolved = await Effect.runPromise(
			resolveSlotPath(appModule, slotPath(web, "layout")),
		);

		expect(resolved).toBe("app/layout.tsx");
	});

	it("fails with slot and module details when an app slot is unfilled", async () => {
		const web = ensuredModuleTarget("web");
		const error = await Effect.runPromise(
			Effect.flip(resolveSlotPath(appModule, slotPath(web, "trpc"))),
		);

		expect(error).toBeInstanceOf(SlotPathError);
		expect(error.moduleKey).toBe("web");
		expect(error.slot).toBe("trpc");
		expect(error.message).toBe("Module Slot Missing: trpc in web");
	});

	it("fails when no template is selected for an app addon", async () => {
		const error = await resolveFailure(
			compatibilityAddon({ app: { frameworks: ["nextjs"] } }),
			{ style: "tailwind" },
		);

		expect(error).toBeInstanceOf(GeneratorError);
		expect(error.generatorId).toBe("tailwind");
		expect(error.message).toBe(
			"Tailwind CSS requires a web framework template.",
		);
	});

	it("fails when the addon requires a different framework", async () => {
		const error = await resolveFailure(
			compatibilityAddon({ app: { frameworks: ["astro"] } }),
		);

		expect(error).toBeInstanceOf(GeneratorError);
		expect(error.generatorId).toBe("tailwind");
		expect(error.message).toBe("Tailwind CSS does not support Next.js.");
	});

	it("fails when the addon requires a different template version", async () => {
		const error = await resolveFailure(
			compatibilityAddon({
				app: { templates: [{ id: "nextjs/base", version: 2 }] },
			}),
		);

		expect(error).toBeInstanceOf(GeneratorError);
		expect(error.generatorId).toBe("tailwind");
		expect(error.message).toBe(
			"Tailwind CSS does not support the selected Next.js template.",
		);
	});

	it("fails when the framework lacks a required slot", async () => {
		const error = await resolveFailure(
			compatibilityAddon({ app: { requiredSlots: ["db"] } }),
		);

		expect(error).toBeInstanceOf(GeneratorError);
		expect(error.generatorId).toBe("tailwind");
		expect(error.message).toBe(
			"Tailwind CSS requires the db slot, but Next.js does not provide it.",
		);
	});

	it("checks compatibility against app and package modules", () => {
		expect(isAddonCompatibleWithModule(appAddon, appModule)).toBe(true);
		expect(isAddonCompatibleWithModule(packageAddon, packageModule)).toBe(true);
	});

	it("allows any module when the addon declares no compatibility", () => {
		const addon = defineAddon<TestConfig>({
			id: "anywhere",
			name: "Anywhere",
			version: "0.1.0",
			category: "addon",
			exclusive: false,
			targetMode: "multiple",
			when: () => false,
			contribute: () => [],
		});

		expect(isAddonCompatibleWithModule(addon, appModule)).toBe(true);
		expect(isAddonCompatibleWithModule(addon, packageModule)).toBe(true);
	});

	it("rejects modules whose type has no compatibility entry", () => {
		expect(isAddonCompatibleWithModule(appAddon, packageModule)).toBe(false);
		expect(isAddonCompatibleWithModule(packageAddon, appModule)).toBe(false);
	});

	it("matches app templates by exact id or short id suffix", () => {
		expect(
			isAddonCompatibleWithModule(appAddon, {
				...appModule,
				template: { id: "nextjs/base", version: 1 },
			}),
		).toBe(true);

		expect(
			isAddonCompatibleWithModule(appAddon, {
				...appModule,
				template: { id: "other", version: 1 },
			}),
		).toBe(false);

		expect(
			isAddonCompatibleWithModule(appAddon, {
				...appModule,
				template: { id: "base", version: 2 },
			}),
		).toBe(false);
	});

	it("rejects app modules that violate a single app constraint", () => {
		expect(
			isAddonCompatibleWithModule(appAddon, {
				...appModule,
				framework: "astro",
			}),
		).toBe(false);

		expect(
			isAddonCompatibleWithModule(appAddon, { ...appModule, slots: {} }),
		).toBe(false);
	});

	it("rejects package modules that violate a single package constraint", () => {
		expect(
			isAddonCompatibleWithModule(packageAddon, {
				...packageModule,
				slots: {},
			}),
		).toBe(false);

		expect(
			isAddonCompatibleWithModule(packageAddon, {
				...packageModule,
				capabilities: ["react"],
			}),
		).toBe(false);
	});
});
