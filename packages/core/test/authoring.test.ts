import { NodeContext } from "@effect/platform-node";
import { Cause, Effect, Exit, Layer, Option } from "effect";
import { describe, expect, it } from "vitest";
import {
	CoreLive,
	defineAddon,
	defineFramework,
	defineRegistry,
	defineTemplate,
	filePath,
	isAddonCompatibleWithModule,
	resolveDefinitions,
	textFile,
} from "../src/index";

interface TestConfig {
	readonly style?: "tailwind";
	readonly web?: "nextjs";
}

const coreLayer = CoreLive.pipe(Layer.provideMerge(NodeContext.layer));

describe("authoring", () => {
	it("resolves templates and addons through the public definitions", async () => {
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
			contribute: () => [
				textFile(filePath("apps/web/app/layout.tsx"), "layout"),
			],
		});

		const addon = defineAddon<TestConfig>({
			id: "tailwind",
			name: "Tailwind CSS",
			version: "0.1.0",
			category: "style",
			exclusive: true,
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

		const generators = await Effect.runPromise(
			resolveDefinitions(
				{ style: "tailwind", web: "nextjs" },
				defineRegistry({
					frameworks: [framework],
					templates: [template],
					addons: [addon],
				}),
			),
		);

		expect(generators.map((generator) => generator.id)).toEqual([
			"nextjs/base",
			"tailwind",
		]);

		const tailwindGenerator = generators[1];
		expect(tailwindGenerator).toBeDefined();
		if (!tailwindGenerator) throw new Error("Missing Tailwind Generator");

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

	it("fails with a typed error when addon compatibility is invalid", async () => {
		const framework = defineFramework({
			id: "nextjs",
			name: "Next.js",
			slots: ["layout"],
		});

		const addon = defineAddon<TestConfig>({
			id: "tailwind",
			name: "Tailwind CSS",
			version: "0.1.0",
			category: "style",
			exclusive: true,
			targetMode: "single",
			compatibility: {
				app: {
					frameworks: ["nextjs"],
				},
			},
			when: (config) => config.style === "tailwind",
			contribute: () => [],
		});

		await expect(
			Effect.runPromiseExit(
				resolveDefinitions(
					{ style: "tailwind" },
					defineRegistry({
						frameworks: [framework],
						templates: [],
						addons: [addon],
					}),
				),
			),
		).resolves.toSatisfy((exit) => {
			if (!Exit.isFailure(exit)) return false;

			const failure = Cause.failureOption(exit.cause);
			if (Option.isNone(failure)) return false;
			const error = failure.value as {
				readonly _tag?: string;
				readonly generatorId?: string;
				readonly message?: string;
			};

			return (
				error._tag === "GeneratorError" &&
				error.generatorId === "tailwind" &&
				error.message === "Template Required"
			);
		});
	});

	it("checks compatibility against app and package modules", () => {
		const appAddon = defineAddon<TestConfig>({
			id: "tailwind",
			name: "Tailwind CSS",
			version: "0.1.0",
			category: "style",
			exclusive: true,
			targetMode: "single",
			compatibility: {
				app: {
					frameworks: ["nextjs"],
					requiredSlots: ["layout"],
					templates: [{ id: "nextjs/base", version: 1 }],
				},
			},
			when: () => false,
			contribute: () => [],
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

		expect(
			isAddonCompatibleWithModule(appAddon, {
				id: "abcde",
				type: "app",
				framework: "nextjs",
				template: { id: "base", version: 1 },
				slots: { layout: "app/layout.tsx" },
			}),
		).toBe(true);

		expect(
			isAddonCompatibleWithModule(packageAddon, {
				id: "fghij",
				type: "package",
				packageType: "library",
				template: { id: "ui", version: 1 },
				capabilities: ["react", "ui"],
				slots: { utils: "src/lib/utils.ts" },
			}),
		).toBe(true);

		expect(
			isAddonCompatibleWithModule(packageAddon, {
				id: "klmno",
				type: "package",
				packageType: "library",
				template: { id: "ui", version: 1 },
				capabilities: ["react"],
				slots: {},
			}),
		).toBe(false);
	});
});
