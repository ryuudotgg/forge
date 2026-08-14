import { renderRecipeAsset, validateTemplateRecipes } from "@ryuujs/core";
import { describe, expect, it } from "vitest";
import { builtins } from "../src";
import { readTemplate } from "../src/template";

// A recipe serves the frameworks its variants name, narrowed to the ones its
// addon actually has adapters for: variants also exist for frameworks that
// only receive a client rendered by another recipe's hooks.
function recipeFrameworks(recipe: (typeof builtins.recipes)[number]) {
	const declared = new Set(
		recipe.assets.flatMap((asset) =>
			asset._tag === "SharedAssetDefinition" ? [] : Object.keys(asset.variants),
		),
	);

	return builtins.frameworks.filter(
		(framework) =>
			(declared.size === 0 || declared.has(framework.id)) &&
			builtins.adapters.some(
				(adapter) =>
					adapter.addon === recipe.addon && adapter.framework === framework.id,
			),
	);
}

describe("first-party template recipes", () => {
	it("validates every recipe against the on-disk templates", () => {
		expect(() =>
			validateTemplateRecipes(
				builtins.recipes,
				builtins.frameworks,
				readTemplate,
			),
		).not.toThrow();
	});

	it("rejects an undeclared marker introduced into a real template", () => {
		expect(() =>
			validateTemplateRecipes(
				builtins.recipes,
				builtins.frameworks,
				(path) => `${readTemplate(path)}\n__BOGUS__\n`,
			),
		).toThrow("Recipe Marker Undeclared: __BOGUS__");
	});

	it("resolves every recipe asset for every adapter-covered framework", () => {
		for (const recipe of builtins.recipes) {
			const markers = Object.fromEntries(
				Object.keys(recipe.markers).map((name) => [name, "false"]),
			);

			for (const framework of recipeFrameworks(recipe)) {
				const slots = Object.fromEntries(
					framework.slots.map((slot) => [slot, `slot:${slot}`]),
				);

				for (const asset of recipe.assets) {
					const rendered = renderRecipeAsset(recipe, asset, framework, {
						markers,
						readTemplate,
						slots,
					});

					expect(
						rendered.destination,
						`${recipe.addon}:${asset.name}`,
					).not.toBe("");
				}
			}
		}
	});

	it("serves every adapter framework from one of its addon's recipes", () => {
		for (const adapter of builtins.adapters) {
			const served = builtins.recipes
				.filter((recipe) => recipe.addon === adapter.addon)
				.flatMap((recipe) =>
					recipeFrameworks(recipe).map((framework) => framework.id),
				);

			expect(served, `${adapter.addon}:${adapter.framework}`).toContain(
				adapter.framework,
			);
		}
	});
});
