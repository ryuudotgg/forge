import { NodeContext } from "@effect/platform-node";
import { Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";
import {
	type AddonDefinition,
	type AppConfig,
	type Compatibility,
	CoreLive,
	configFragment,
	defineAddon,
	defineFramework,
	defineRegistry,
	defineTemplate,
	dependencies,
	envEntries,
	filePath,
	GeneratorError,
	isAddonCompatibleWithModule,
	jsonFile,
	leafTextFile,
	lines,
	lowerContributions,
	moduleCapabilities,
	type PackageConfig,
	projectTarget,
	resolveDefinitions,
	scripts,
	selectedModuleTarget,
	surfaceLines,
	surfaceText,
	textFile,
} from "../src/index";

interface TestConfig {
	readonly style?: "tailwind";
	readonly web?: "nextjs";
}

const coreLayer = CoreLive.pipe(Layer.provideMerge(NodeContext.layer));

const framework = defineFramework({
	id: "nextjs",
	name: "Next.js",
	slots: ["layout", "page"],
});

const template = defineTemplate<TestConfig>({
	id: "nextjs/base",
	framework: "nextjs",
	name: "Base",
	version: 1,
	category: "web",
	exclusive: true,
	when: (config) => config.web === "nextjs",
	contribute: () => [textFile(filePath("apps/web/app/layout.tsx"), "layout")],
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
			resolveDefinitions(
				config,
				defineRegistry({
					frameworks: [framework],
					templates: [template],
					addons: [addon],
				}),
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
	it("resolves templates and addons through the public definitions", async () => {
		const addon = defineAddon<TestConfig>({
			id: "tailwind",
			name: "Tailwind CSS",
			version: "0.1.0",
			category: "style",
			exclusive: true,
			dependencies: [{ id: "nextjs/base", type: "template" }],
			targetMode: "single",
			compatibility: {
				app: {
					frameworks: ["nextjs"],
					requiredSlots: ["layout"],
					templates: [{ id: "nextjs/base", version: 1 }],
				},
			},
			when: (config) => config.style === "tailwind",
			contribute: () => [
				textFile(filePath("apps/web/src/styles/globals.css"), "globals"),
			],
		});

		const skippedAddon = defineAddon<TestConfig>({
			id: "biome",
			name: "Biome",
			version: "0.1.0",
			category: "linter",
			exclusive: true,
			targetMode: "single",
			when: () => false,
			contribute: () => [],
		});

		const generators = await Effect.runPromise(
			resolveDefinitions(
				{ style: "tailwind", web: "nextjs" },
				defineRegistry({
					frameworks: [framework],
					templates: [template],
					addons: [addon, skippedAddon],
				}),
			),
		);

		expect(generators.map((generator) => generator.id)).toEqual([
			"nextjs/base",
			"tailwind",
		]);

		const templateGenerator = generators[0];
		expect(templateGenerator).toBeDefined();
		if (!templateGenerator) throw new Error("Missing Template Generator");

		expect(templateGenerator).toMatchObject({
			name: "Base",
			version: "1",
			category: "web",
			exclusive: true,
			dependencies: [],
		});

		const templateOperations = await Effect.runPromise(
			templateGenerator
				.generate({ style: "tailwind", web: "nextjs" })
				.pipe(Effect.provide(coreLayer)),
		);

		expect(templateOperations).toEqual([
			{
				_tag: "CreateFile",
				path: filePath("apps/web/app/layout.tsx"),
				content: "layout",
			},
		]);

		const tailwindGenerator = generators[1];
		expect(tailwindGenerator).toBeDefined();
		if (!tailwindGenerator) throw new Error("Missing Tailwind Generator");

		expect(tailwindGenerator).toMatchObject({
			name: "Tailwind CSS",
			version: "0.1.0",
			category: "style",
			exclusive: true,
			dependencies: ["nextjs/base"],
		});

		const tailwindOperations = await Effect.runPromise(
			tailwindGenerator
				.generate({ style: "tailwind", web: "nextjs" })
				.pipe(Effect.provide(coreLayer)),
		);

		expect(tailwindOperations).toEqual([
			{
				_tag: "CreateFile",
				path: filePath("apps/web/src/styles/globals.css"),
				content: "globals",
			},
		]);
	});

	it("fails when no template is selected for an app addon", async () => {
		const error = await resolveFailure(
			compatibilityAddon({ app: { frameworks: ["nextjs"] } }),
			{ style: "tailwind" },
		);

		expect(error).toBeInstanceOf(GeneratorError);
		expect(error.generatorId).toBe("tailwind");
		expect(error.message).toBe("Template Required");
	});

	it("fails when the addon requires a different framework", async () => {
		const error = await resolveFailure(
			compatibilityAddon({ app: { frameworks: ["astro"] } }),
		);

		expect(error).toBeInstanceOf(GeneratorError);
		expect(error.generatorId).toBe("tailwind");
		expect(error.message).toBe("Framework Compatibility Failed");
	});

	it("fails when the addon requires a different template version", async () => {
		const error = await resolveFailure(
			compatibilityAddon({
				app: { templates: [{ id: "nextjs/base", version: 2 }] },
			}),
		);

		expect(error).toBeInstanceOf(GeneratorError);
		expect(error.generatorId).toBe("tailwind");
		expect(error.message).toBe("Template Compatibility Failed");
	});

	it("fails when the framework lacks a required slot", async () => {
		const error = await resolveFailure(
			compatibilityAddon({ app: { requiredSlots: ["db"] } }),
		);

		expect(error).toBeInstanceOf(GeneratorError);
		expect(error.generatorId).toBe("tailwind");
		expect(error.message).toBe("Required Slots Missing");
	});

	it("fails when multiple templates match the configuration", async () => {
		const sibling = defineTemplate<TestConfig>({
			id: "nextjs/marketing",
			framework: "nextjs",
			name: "Marketing",
			version: 1,
			category: "web",
			exclusive: true,
			when: (config) => config.web === "nextjs",
			contribute: () => [],
		});

		const error = await Effect.runPromise(
			Effect.flip(
				resolveDefinitions(
					{ web: "nextjs" },
					defineRegistry({
						frameworks: [framework],
						templates: [template, sibling],
						addons: [],
					}),
				),
			),
		);

		expect(error).toBeInstanceOf(GeneratorError);
		expect(error.generatorId).toBe("registry");
		expect(error.message).toBe("Multiple Templates Selected");
	});

	it("fails when the selected template references an unregistered framework", async () => {
		const error = await Effect.runPromise(
			Effect.flip(
				resolveDefinitions(
					{ web: "nextjs" },
					defineRegistry({
						frameworks: [],
						templates: [template],
						addons: [],
					}),
				),
			),
		);

		expect(error).toBeInstanceOf(GeneratorError);
		expect(error.generatorId).toBe("nextjs/base");
		expect(error.message).toBe("Framework Definition Missing");
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

	it("lowers each contribution kind to its file operation", async () => {
		const packageJson = filePath("apps/web/package.json");
		const env = filePath("apps/web/.env");
		const entry = filePath("apps/web/src/index.ts");
		const settings = filePath("apps/web/settings.json");
		const tsconfig = filePath("apps/web/tsconfig.json");

		const operations = await Effect.runPromise(
			lowerContributions("golden", [
				jsonFile(settings, { compilerOptions: { strict: true } }),
				dependencies(packageJson, [
					{ name: "react", version: "19.0.0", type: "dependencies" },
				]),
				scripts(packageJson, { dev: "next dev" }),
				envEntries(env, "Database", ["DATABASE_URL="]),
				lines(entry, ['import "./globals.css";'], {
					position: "start",
					section: "imports",
				}),
				configFragment(tsconfig, { compilerOptions: { jsx: "preserve" } }),
				configFragment(tsconfig, { extends: "./base.json" }, "replace"),
			]),
		);

		expect(operations).toEqual([
			{
				_tag: "CreateJson",
				path: settings,
				value: { compilerOptions: { strict: true } },
			},
			{
				_tag: "AddDependencies",
				path: packageJson,
				dependencies: [
					{ name: "react", version: "19.0.0", type: "dependencies" },
				],
			},
			{ _tag: "AddScripts", path: packageJson, scripts: { dev: "next dev" } },
			{
				_tag: "AppendLines",
				path: env,
				lines: ["DATABASE_URL="],
				position: undefined,
				section: "Database",
			},
			{
				_tag: "AppendLines",
				path: entry,
				lines: ['import "./globals.css";'],
				position: "start",
				section: "imports",
			},
			{
				_tag: "MergeJson",
				path: tsconfig,
				value: { compilerOptions: { jsx: "preserve" } },
				strategy: "deep",
			},
			{
				_tag: "MergeJson",
				path: tsconfig,
				value: { extends: "./base.json" },
				strategy: "replace",
			},
		]);
	});

	it("lowers planner routed contributions to no file operations", async () => {
		const operations = await Effect.runPromise(
			lowerContributions("routed", [
				surfaceText(projectTarget(), "gitignore", "node_modules"),
				surfaceLines(selectedModuleTarget(), "env", ["DATABASE_URL="], {
					section: "Database",
				}),
				moduleCapabilities(selectedModuleTarget(), ["ui"]),
				leafTextFile(selectedModuleTarget(), "src/lib/utils.ts", "export {};"),
			]),
		);

		expect(operations).toEqual([]);
	});

	it("resolves contributions returned as a promise or an effect", async () => {
		const asyncTemplate = defineTemplate<TestConfig>({
			id: "nextjs/base",
			framework: "nextjs",
			name: "Base",
			version: 1,
			category: "web",
			exclusive: true,
			when: (config) => config.web === "nextjs",
			contribute: async () => [
				textFile(filePath("apps/web/app/layout.tsx"), "layout"),
			],
		});

		const effectAddon = defineAddon<TestConfig>({
			id: "tailwind",
			name: "Tailwind CSS",
			version: "0.1.0",
			category: "style",
			exclusive: true,
			targetMode: "single",
			when: (config) => config.style === "tailwind",
			contribute: () =>
				Effect.succeed([
					textFile(filePath("apps/web/src/styles/globals.css"), "globals"),
				]),
		});

		const generators = await Effect.runPromise(
			resolveDefinitions(
				{ style: "tailwind", web: "nextjs" },
				defineRegistry({
					frameworks: [framework],
					templates: [asyncTemplate],
					addons: [effectAddon],
				}),
			),
		);

		const operations = await Effect.runPromise(
			Effect.forEach(generators, (generator) =>
				generator.generate({ style: "tailwind", web: "nextjs" }),
			).pipe(
				Effect.map((groups) => groups.flat()),
				Effect.provide(coreLayer),
			),
		);

		expect(operations).toEqual([
			{
				_tag: "CreateFile",
				path: filePath("apps/web/app/layout.tsx"),
				content: "layout",
			},
			{
				_tag: "CreateFile",
				path: filePath("apps/web/src/styles/globals.css"),
				content: "globals",
			},
		]);
	});

	it("fails the generator when a promise contribution rejects", async () => {
		const addon = defineAddon<TestConfig>({
			id: "broken",
			name: "Broken",
			version: "0.1.0",
			category: "addon",
			exclusive: false,
			targetMode: "multiple",
			when: () => true,
			contribute: () => Promise.reject(new Error("boom")),
		});

		const generators = await Effect.runPromise(
			resolveDefinitions(
				{},
				defineRegistry({ frameworks: [], templates: [], addons: [addon] }),
			),
		);

		const generator = generators[0];
		expect(generator).toBeDefined();
		if (!generator) throw new Error("Missing Broken Generator");

		const error = await Effect.runPromise(
			Effect.flip(generator.generate({}).pipe(Effect.provide(coreLayer))),
		);

		expect(error).toBeInstanceOf(GeneratorError);
		expect(error.generatorId).toBe("broken");
		expect(error.message).toBe("Definition Failed: boom");
	});
});
