import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import {
	type AddonDefinition,
	type AppConfig,
	authoringApiVersion,
	type Compatibility,
	defineAdapter,
	defineAddon,
	defineFramework,
	defineRegistry,
	defineTemplate,
	deriveAddonFrameworks,
	ensuredModuleTarget,
	GeneratorError,
	isAddonCompatibleWithModule,
	moduleTarget,
	type PackageConfig,
	RegistryError,
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
	template: { id: "nextjs/base", version: 1 },
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
	it("derives the authoring API version from the core package major", () => {
		expect(authoringApiVersion).toBe(1);
	});

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
		expect(error.module).toBe("web");
		expect(error.slot).toBe("trpc");
		expect(error.message).toBe("Module Slot Missing: trpc in web");
	});

	it("reports a resolved module root when its slot is unfilled", async () => {
		const target = moduleTarget({
			config: appModule,
			id: appModule.id,
			root: "apps/web",
		});
		const error = await Effect.runPromise(
			Effect.flip(resolveSlotPath(appModule, slotPath(target, "trpc"))),
		);

		expect(error.module).toBe("apps/web");
		expect(error.message).toBe("Module Slot Missing: trpc in apps/web");
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

	it("matches app templates by exact id", () => {
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
				template: { id: "nextjs/base", version: 2 },
			}),
		).toBe(false);

		expect(
			isAddonCompatibleWithModule(appAddon, {
				...appModule,
				template: { id: "other/base", version: 1 },
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

	it("derives adapter target candidates from app framework registrations", () => {
		const addon = defineAddon<TestConfig>({
			id: "adapter-addon",
			name: "Adapter Addon",
			version: "0.1.0",
			category: "addon",
			exclusive: false,
			targetMode: "multiple",
			when: () => true,
			contribute: () => [],
		});
		const adapter = defineAdapter<TestConfig>({
			addon: "adapter-addon",
			framework: "nextjs",
			requiredSlots: ["layout"],
			contribute: () => [],
		});

		expect(
			isAddonCompatibleWithModule(addon, appModule, [framework], [adapter]),
		).toBe(true);
		expect(
			isAddonCompatibleWithModule(
				addon,
				{ ...appModule, slots: {} },
				[framework],
				[adapter],
			),
		).toBe(true);
		expect(
			isAddonCompatibleWithModule(
				addon,
				{ ...appModule, framework: "tanstack-start" },
				[framework],
				[adapter],
			),
		).toBe(false);
		expect(
			isAddonCompatibleWithModule(addon, packageModule, [framework], [adapter]),
		).toBe(false);
	});

	it("unions declared and adapter-derived app framework support", () => {
		const addon = compatibilityAddon({
			app: { frameworks: ["nextjs"] },
		});
		const adapter = defineAdapter<TestConfig>({
			addon: addon.id,
			framework: "solid",
			contribute: () => [],
		});
		const solidModule: AppConfig = {
			...appModule,
			framework: "solid",
		};

		expect(deriveAddonFrameworks(addon, [adapter])).toEqual([
			"nextjs",
			"solid",
		]);
		expect(
			isAddonCompatibleWithModule(addon, appModule, [framework], [adapter]),
		).toBe(true);
		expect(
			isAddonCompatibleWithModule(addon, solidModule, [framework], [adapter]),
		).toBe(true);
	});

	it("treats unconstrained app compatibility as universal support", () => {
		const addon = compatibilityAddon({ app: {} });
		const adapter = defineAdapter<TestConfig>({
			addon: addon.id,
			framework: "solid",
			contribute: () => [],
		});

		expect(deriveAddonFrameworks(addon, [adapter])).toBeUndefined();
		expect(
			isAddonCompatibleWithModule(addon, appModule, [framework], [adapter]),
		).toBe(true);
	});

	it("uses the adapter registry for the missing-framework sentence", async () => {
		const addon = defineAddon<TestConfig>({
			id: "trpc",
			name: "tRPC",
			version: "0.1.0",
			category: "addon",
			exclusive: false,
			targetMode: "single",
			when: () => true,
			contribute: () => [],
		});
		const adapter = defineAdapter<TestConfig>({
			addon: "trpc",
			framework: "astro",
			contribute: () => [],
		});

		const error = await Effect.runPromise(
			Effect.flip(
				validateAddonAgainstSelection(addon, framework, template, [adapter]),
			),
		);

		expect(error.message).toBe("tRPC does not support Next.js yet.");
	});

	it("requires a framework selection when an addon has adapters", async () => {
		const addon = defineAddon<TestConfig>({
			id: "trpc",
			name: "tRPC",
			version: "0.1.0",
			category: "addon",
			exclusive: false,
			targetMode: "single",
			when: () => true,
			contribute: () => [],
		});
		const adapter = defineAdapter<TestConfig>({
			addon: "trpc",
			framework: "nextjs",
			contribute: () => [],
		});

		const error = await Effect.runPromise(
			Effect.flip(
				validateAddonAgainstSelection(addon, undefined, undefined, [adapter]),
			),
		);

		expect(error).toBeInstanceOf(GeneratorError);
		expect(error.message).toBe("tRPC requires a web framework template.");
	});

	it("accepts package-only compatibility when an addon also has adapters", async () => {
		const addon = defineAddon<TestConfig>({
			id: "package-tools",
			name: "Package Tools",
			version: "0.1.0",
			category: "addon",
			exclusive: false,
			targetMode: "multiple",
			compatibility: { package: { capabilities: ["ui"] } },
			when: () => true,
			contribute: () => [],
		});
		const adapter = defineAdapter<TestConfig>({
			addon: addon.id,
			framework: "solid",
			contribute: () => [],
		});

		await expect(
			Effect.runPromise(
				validateAddonAgainstSelection(addon, framework, template, [adapter]),
			),
		).resolves.toBeUndefined();
	});

	it("defaults an explicitly undefined adapter slot list", () => {
		const adapter = defineAdapter<TestConfig>({
			addon: "tailwind",
			framework: "nextjs",
			requiredSlots: undefined,
			contribute: () => [],
		});

		expect(adapter.requiredSlots).toEqual([]);
	});

	it("validates framework slot declarations at registration", () => {
		const invalidFramework = defineFramework({
			id: "invalid",
			configFile: "invalid.config.ts",
			buildOutputs: [],
			ignoreDirs: [],
			name: "Invalid",
			slots: ["layout", "layout"],
			tsconfigPreset: { content: {}, name: "invalid" },
		});

		expect(() =>
			defineRegistry({
				frameworks: [invalidFramework],
				templates: [],
				addons: [],
			}),
		).toThrow(RegistryError);
	});

	it("rejects an adapter slot absent from its framework", () => {
		const adapter = defineAdapter<TestConfig>({
			addon: "tailwind",
			framework: "nextjs",
			requiredSlots: ["layuot"],
			contribute: () => [],
		});

		expect(() =>
			defineRegistry({
				adapters: [adapter],
				frameworks: [framework],
				templates: [],
				addons: [appAddon],
			}),
		).toThrow("Adapter Slot Missing: tailwind:nextjs:layuot");
	});

	it("rejects duplicate addon-framework adapters", () => {
		const adapter = defineAdapter<TestConfig>({
			addon: "tailwind",
			framework: "nextjs",
			contribute: () => [],
		});

		expect(() =>
			defineRegistry({
				adapters: [adapter, adapter],
				frameworks: [framework],
				templates: [],
				addons: [appAddon],
			}),
		).toThrow("Adapter Duplicate: tailwind:nextjs");
	});

	it.each([
		[
			"Addon Duplicate: tailwind",
			{ addons: [appAddon, appAddon], frameworks: [framework], templates: [] },
		],
		[
			"Framework Duplicate: nextjs",
			{ addons: [appAddon], frameworks: [framework, framework], templates: [] },
		],
		[
			"Template Duplicate: nextjs/base",
			{
				addons: [appAddon],
				frameworks: [framework],
				templates: [template, template],
			},
		],
	])("rejects duplicate registry units with %s", (message, registry) => {
		expect(() => defineRegistry(registry)).toThrow(message);
	});

	it("rejects an adapter for a missing addon", () => {
		const adapter = defineAdapter<TestConfig>({
			addon: "missing",
			framework: "nextjs",
			contribute: () => [],
		});
		const register = () =>
			defineRegistry({
				adapters: [adapter],
				frameworks: [framework],
				templates: [],
				addons: [appAddon],
			});

		expect(register).toThrow(RegistryError);
		expect(register).toThrow("Adapter Addon Missing: missing");
	});

	it("rejects an adapter for a missing framework", () => {
		const adapter = defineAdapter<TestConfig>({
			addon: "tailwind",
			framework: "astro",
			contribute: () => [],
		});

		expect(() =>
			defineRegistry({
				adapters: [adapter],
				frameworks: [framework],
				templates: [],
				addons: [appAddon],
			}),
		).toThrow("Adapter Framework Missing: astro");
	});
});
