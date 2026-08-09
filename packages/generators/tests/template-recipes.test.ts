import { renderRecipeAsset, validateTemplateRecipes } from "@ryuujs/core";
import { describe, expect, it } from "vitest";
import { builtins } from "../src";
import { readTemplate } from "../src/template";

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

	it("resolves every recipe asset for every framework", () => {
		for (const recipe of builtins.recipes) {
			const markers = Object.fromEntries(
				Object.keys(recipe.markers).map((name) => [name, "false"]),
			);

			for (const framework of builtins.frameworks) {
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
});
