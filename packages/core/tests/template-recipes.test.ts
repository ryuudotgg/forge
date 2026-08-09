import { describe, expect, it } from "vitest";
import {
	defineFramework,
	defineRegistry,
	defineTemplateRecipe,
	inModule,
	inSourceRoot,
	marker,
	renderRecipeAsset,
	sharedAsset,
	slotAsset,
	validateTemplateRecipes,
	variantAsset,
} from "../src/index";

const framework = defineFramework({
	id: "nextjs",
	configFile: "next.config.ts",
	buildOutputs: [".next/**"],
	ignoreDirs: [".next/"],
	name: "Next.js",
	sourceRoot: "src",
	slots: ["trpc"],
	tsconfigPreset: { content: {}, name: "nextjs" },
});

const tanstackStart = defineFramework({
	id: "tanstack-start",
	configFile: "app.config.ts",
	buildOutputs: [".output/**"],
	ignoreDirs: [".output/"],
	name: "TanStack Start",
	sourceRoot: "src",
	slots: ["trpc"],
	tsconfigPreset: { content: {}, name: "tanstack-start" },
});

function fixtureReader(fixtures: Readonly<Record<string, string>>) {
	return (path: string) => {
		const fixture = fixtures[path];
		if (fixture === undefined) throw new Error(`Fixture Missing: ${path}`);
		return fixture;
	};
}

describe("template recipe authoring", () => {
	it("constructs tagged markers, destinations, assets, and recipes", () => {
		const shared = sharedAsset("client", {
			template: "client.ts",
			destination: inSourceRoot("trpc/client.ts"),
		});
		const variant = variantAsset("server", {
			destination: inModule("packages/api/src/server.ts"),
			variants: { nextjs: "server/rsc.ts" },
		});
		const slot = slotAsset("trpc", {
			variants: { nextjs: "routes/nextjs.ts" },
		});
		const recipe = defineTemplateRecipe({
			addon: "trpc",
			markers: {
				NAME: marker.required,
				AUTH_IMPORT: marker.toggleLine("// __AUTH_IMPORT__\n"),
				AUTH_ARG: marker.toggleInline("/* __AUTH_ARG__ */ "),
			},
			assets: [shared, variant, slot],
		});

		expect(recipe).toEqual({
			_tag: "TemplateRecipeDefinition",
			addon: "trpc",
			markers: {
				NAME: { _tag: "RequiredMarker" },
				AUTH_IMPORT: {
					_tag: "ToggleLineMarker",
					carrier: "// __AUTH_IMPORT__\n",
				},
				AUTH_ARG: {
					_tag: "ToggleInlineMarker",
					carrier: "/* __AUTH_ARG__ */ ",
				},
			},
			assets: [shared, variant, slot],
		});
		expect(shared.destination).toEqual({
			_tag: "SourceRootDestination",
			relativePath: "trpc/client.ts",
		});
		expect(variant.destination).toEqual({
			_tag: "ModuleDestination",
			relativePath: "packages/api/src/server.ts",
		});
		expect(slot).toEqual({
			_tag: "SlotAssetDefinition",
			name: "trpc",
			slot: "trpc",
			variants: { nextjs: "routes/nextjs.ts" },
		});
	});
});

describe("template recipe validation", () => {
	it("rejects malformed marker names before reading templates", () => {
		const recipe = defineTemplateRecipe({
			addon: "trpc",
			markers: { BAD__NAME: marker.required },
			assets: [
				sharedAsset("client", {
					template: "client.ts",
					destination: inModule("client.ts"),
				}),
			],
		});

		expect(() =>
			validateTemplateRecipes([recipe], [framework], () => {
				throw new Error("Template reader should not run");
			}),
		).toThrow(
			"Recipe Marker Invalid: BAD__NAME (trpc): name does not match the marker-name format",
		);
	});

	it("rejects toggle carriers without their own marker pattern", () => {
		const recipe = defineTemplateRecipe({
			addon: "trpc",
			markers: { AUTH: marker.toggleLine("// __OTHER__\n") },
			assets: [
				sharedAsset("client", {
					template: "client.ts",
					destination: inModule("client.ts"),
				}),
			],
		});

		expect(() =>
			validateTemplateRecipes([recipe], [framework], () => {
				throw new Error("Template reader should not run");
			}),
		).toThrow(
			"Recipe Marker Invalid: AUTH (trpc): carrier does not contain __AUTH__",
		);
	});

	it("rejects duplicate marker replacement keys", () => {
		const recipe = defineTemplateRecipe({
			addon: "trpc",
			markers: {
				A: marker.toggleLine("// __A____B__\n"),
				B: marker.toggleLine("// __A____B__\n"),
			},
			assets: [
				sharedAsset("client", {
					template: "client.ts",
					destination: inModule("client.ts"),
				}),
			],
		});

		expect(() =>
			validateTemplateRecipes([recipe], [framework], () => {
				throw new Error("Template reader should not run");
			}),
		).toThrow("Recipe Marker Invalid: B (trpc): replacement key duplicates A");
	});

	it("validates recipes during registry construction", () => {
		const recipe = defineTemplateRecipe({
			addon: "trpc",
			markers: {
				NAME: marker.required,
				AUTH_IMPORT: marker.toggleLine("// __AUTH_IMPORT__\n"),
			},
			assets: [
				sharedAsset("client", {
					template: "client.ts",
					destination: inSourceRoot("trpc/client.ts"),
				}),
			],
		});
		const registry = defineRegistry({
			frameworks: [framework],
			templates: [],
			addons: [],
			recipes: [recipe],
			readTemplate: fixtureReader({
				"client.ts": '// __AUTH_IMPORT__\nexport const name = "__NAME__";\n',
			}),
		});

		expect(registry.recipes).toEqual([recipe]);
	});

	it("allows markers to appear in different referenced templates", () => {
		const recipe = defineTemplateRecipe({
			addon: "trpc",
			markers: { A: marker.required, B: marker.required },
			assets: [
				sharedAsset("first", {
					template: "first.ts",
					destination: inModule("first.ts"),
				}),
				sharedAsset("second", {
					template: "second.ts",
					destination: inModule("second.ts"),
				}),
			],
		});

		expect(() =>
			validateTemplateRecipes(
				[recipe],
				[framework],
				fixtureReader({ "first.ts": "__A__", "second.ts": "__B__" }),
			),
		).not.toThrow();
	});

	it("rejects a declared marker absent from all referenced templates", () => {
		const recipe = defineTemplateRecipe({
			addon: "trpc",
			markers: { FOO: marker.required },
			assets: [
				sharedAsset("client", {
					template: "api/trpc/web/query-client.ts",
					destination: inModule("query-client.ts"),
				}),
				sharedAsset("server", {
					template: "api/trpc/web/server.ts",
					destination: inModule("server.ts"),
				}),
			],
		});

		expect(() =>
			validateTemplateRecipes(
				[recipe],
				[framework],
				fixtureReader({
					"api/trpc/web/query-client.ts": "export {};\n",
					"api/trpc/web/server.ts": "export {};\n",
				}),
			),
		).toThrow(
			"Recipe Marker Missing: __FOO__ declared but present in no referenced template (trpc)",
		);
	});

	it("rejects declared markers when no templates are referenced", () => {
		const recipe = defineTemplateRecipe({
			addon: "trpc",
			markers: { FOO: marker.required },
			assets: [],
		});

		expect(() =>
			validateTemplateRecipes([recipe], [framework], () => {
				throw new Error("Template reader should not run");
			}),
		).toThrow(
			"Recipe Marker Missing: __FOO__ declared but present in no referenced template (trpc)",
		);
	});

	it("rejects an undeclared marker", () => {
		const recipe = defineTemplateRecipe({
			addon: "trpc",
			markers: {},
			assets: [
				sharedAsset("client", {
					template: "api/trpc/web/query-client.ts",
					destination: inModule("query-client.ts"),
				}),
			],
		});

		expect(() =>
			validateTemplateRecipes(
				[recipe],
				[framework],
				fixtureReader({
					"api/trpc/web/query-client.ts": "export const value = __FOO__;\n",
				}),
			),
		).toThrow(
			"Recipe Marker Undeclared: __FOO__ in api/trpc/web/query-client.ts (trpc)",
		);
	});

	it("rejects toggle combinations that leave marker residue", () => {
		const recipe = defineTemplateRecipe({
			addon: "trpc",
			markers: {
				OTHER: marker.required,
				TOGGLE: marker.toggleLine("// __TOGGLE____OTHER__\n"),
			},
			assets: [
				sharedAsset("broken", {
					template: "broken.ts",
					destination: inModule("broken.ts"),
				}),
			],
		});

		expect(() =>
			validateTemplateRecipes(
				[recipe],
				[framework],
				fixtureReader({
					"broken.ts": "// __TOGGLE____OTHER__\n",
				}),
			),
		).toThrow("Recipe Toggle Residue: __TOGGLE__ in broken.ts (trpc)");
	});

	it("rejects duplicate framework destinations across recipes", () => {
		const asset = () =>
			sharedAsset("client", {
				template: "client.ts",
				destination: inSourceRoot("client.ts"),
			});
		const first = defineTemplateRecipe({
			addon: "first",
			markers: {},
			assets: [asset()],
		});
		const second = defineTemplateRecipe({
			addon: "second",
			markers: {},
			assets: [asset()],
		});

		expect(() =>
			validateTemplateRecipes(
				[first, second],
				[framework],
				fixtureReader({ "client.ts": "export {};\n" }),
			),
		).toThrow(
			"Recipe Destination Collision: src/client.ts for nextjs (second)",
		);
	});

	it("does not collide destinations for disjoint framework variants", () => {
		const recipe = defineTemplateRecipe({
			addon: "trpc",
			markers: {},
			assets: [
				variantAsset("next", {
					destination: inModule("server.ts"),
					variants: { nextjs: "next.ts" },
				}),
				variantAsset("tanstack", {
					destination: inModule("server.ts"),
					variants: { "tanstack-start": "tanstack.ts" },
				}),
			],
		});

		expect(() =>
			validateTemplateRecipes(
				[recipe],
				[framework, tanstackStart],
				fixtureReader({
					"next.ts": "export {};\n",
					"tanstack.ts": "export {};\n",
				}),
			),
		).not.toThrow();
	});

	it("rejects variant keys for unknown frameworks", () => {
		const recipe = defineTemplateRecipe({
			addon: "trpc",
			markers: {},
			assets: [
				variantAsset("server", {
					destination: inModule("server.ts"),
					variants: { unknown: "server.ts" },
				}),
			],
		});

		expect(() =>
			validateTemplateRecipes([recipe], [framework], () => {
				throw new Error("Template reader should not run");
			}),
		).toThrow("Recipe Framework Unknown: unknown (trpc)");
	});

	it("rejects slot assets unsupported by their variant framework", () => {
		const recipe = defineTemplateRecipe({
			addon: "trpc",
			markers: {},
			assets: [slotAsset("auth", { variants: { nextjs: "auth.ts" } })],
		});

		expect(() =>
			validateTemplateRecipes([recipe], [framework], () => {
				throw new Error("Template reader should not run");
			}),
		).toThrow("Recipe Slot Unknown: auth for nextjs (trpc)");
	});

	it("does not confuse a slot claim with a literal destination", () => {
		const recipe = defineTemplateRecipe({
			addon: "trpc",
			markers: {},
			assets: [
				sharedAsset("literal", {
					template: "literal.ts",
					destination: inModule("slot:trpc"),
				}),
				slotAsset("trpc", { variants: { nextjs: "slot.ts" } }),
			],
		});

		expect(() =>
			validateTemplateRecipes(
				[recipe],
				[framework],
				fixtureReader({
					"literal.ts": "export {};\n",
					"slot.ts": "export {};\n",
				}),
			),
		).not.toThrow();
	});

	it("accepts and renders adjacent markers", () => {
		const asset = sharedAsset("adjacent", {
			template: "adjacent.ts",
			destination: inModule("adjacent.ts"),
		});
		const recipe = defineTemplateRecipe({
			addon: "adjacent",
			markers: { A: marker.required, B: marker.required },
			assets: [asset],
		});
		const readTemplate = fixtureReader({ "adjacent.ts": "__A____B__" });

		expect(() =>
			validateTemplateRecipes([recipe], [framework], readTemplate),
		).not.toThrow();
		expect(
			renderRecipeAsset(recipe, asset, framework, {
				markers: { A: "left", B: "right" },
				readTemplate,
				slots: {},
			}),
		).toEqual({ destination: "adjacent.ts", content: "leftright" });
	});
});

describe("template recipe rendering", () => {
	it("renders line and inline toggles cleanly in both states", () => {
		const asset = sharedAsset("client", {
			template: "client.ts",
			destination: inSourceRoot("trpc/client.ts"),
		});
		const recipe = defineTemplateRecipe({
			addon: "trpc",
			markers: {
				NAME: marker.required,
				AUTH_IMPORT: marker.toggleLine("// __AUTH_IMPORT__\n"),
				AUTH_ARG: marker.toggleInline("/* __AUTH_ARG__ */ "),
			},
			assets: [asset],
		});
		const readTemplate = fixtureReader({
			"client.ts":
				"// __AUTH_IMPORT__\nexport const __NAME__ = call(/* __AUTH_ARG__ */ value);\n",
		});
		const on = renderRecipeAsset(recipe, asset, framework, {
			markers: {
				NAME: "client",
				AUTH_IMPORT: 'import { auth } from "auth";\n',
				AUTH_ARG: "auth, ",
			},
			readTemplate,
			slots: {},
		});
		const off = renderRecipeAsset(recipe, asset, framework, {
			markers: { NAME: "client", AUTH_IMPORT: "", AUTH_ARG: "" },
			readTemplate,
			slots: {},
		});

		expect(on).toEqual({
			destination: "src/trpc/client.ts",
			content:
				'import { auth } from "auth";\nexport const client = call(auth, value);\n',
		});
		expect(off).toEqual({
			destination: "src/trpc/client.ts",
			content: "export const client = call(value);\n",
		});
		expect(on.content).not.toMatch(/__[A-Z_]+__/);
		expect(off.content).not.toMatch(/__[A-Z_]+__/);
	});

	it("resolves slot assets through the supplied framework slot map", () => {
		const asset = slotAsset("trpc", {
			variants: { nextjs: "routes/nextjs.ts" },
		});
		const recipe = defineTemplateRecipe({
			addon: "trpc",
			markers: {},
			assets: [asset],
		});

		expect(
			renderRecipeAsset(recipe, asset, framework, {
				markers: {},
				readTemplate: fixtureReader({
					"routes/nextjs.ts": "export const handler = true;\n",
				}),
				slots: { trpc: "app/api/trpc/[trpc]/route.ts" },
			}),
		).toEqual({
			destination: "app/api/trpc/[trpc]/route.ts",
			content: "export const handler = true;\n",
		});
	});

	it("names assets when a framework variant is missing", () => {
		const asset = variantAsset("server", {
			destination: inModule("server.ts"),
			variants: { "tanstack-start": "server.ts" },
		});
		const recipe = defineTemplateRecipe({
			addon: "trpc",
			markers: {},
			assets: [asset],
		});

		expect(() =>
			renderRecipeAsset(recipe, asset, framework, {
				markers: {},
				readTemplate: fixtureReader({}),
				slots: {},
			}),
		).toThrow("Recipe Variant Missing: server for nextjs (trpc)");
	});

	it("names assets when a slot destination is missing", () => {
		const asset = slotAsset("trpc", {
			variants: { nextjs: "routes/nextjs.ts" },
		});
		const recipe = defineTemplateRecipe({
			addon: "trpc",
			markers: {},
			assets: [asset],
		});

		expect(() =>
			renderRecipeAsset(recipe, asset, framework, {
				markers: {},
				readTemplate: fixtureReader({ "routes/nextjs.ts": "export {};\n" }),
				slots: {},
			}),
		).toThrow("Recipe Slot Missing: trpc for trpc (trpc)");
	});
});
