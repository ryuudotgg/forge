import { describe, expect, it } from "vitest";
import {
	getCatalogEntry,
	listCatalogEntries,
	listVisibleAddons,
	loadAddonDefinition,
	loadDefinitionRegistry,
} from "../src/index";

describe("catalog", () => {
	it("lists visible first-party addons only", async () => {
		const addons = await listVisibleAddons();

		expect(addons.some((entry) => entry.id === "tailwind")).toBe(true);
		expect(addons.some((entry) => entry.id === "root")).toBe(false);
		expect(addons.every((entry) => entry.kind === "addon")).toBe(true);
	});

	it("resolves catalog entries by kind and id", async () => {
		expect(
			(await listCatalogEntries("framework")).map((entry) => entry.id),
		).toContain("nextjs");

		expect(await getCatalogEntry("nextjs/base")).toMatchObject({
			id: "nextjs/base",
			kind: "template",
			name: "Base",
		});

		expect(await getCatalogEntry("tailwind")).toMatchObject({
			id: "tailwind",
			kind: "addon",
			name: "Tailwind CSS",
			targetMode: "single",
		});
	});

	it("keeps curated catalog entries aligned with loadable definitions", async () => {
		const catalog = await listCatalogEntries();
		const registry = await loadDefinitionRegistry();

		expect(
			catalog
				.filter((entry) => entry.kind === "framework")
				.every((entry) =>
					registry.registry.frameworks.some(
						(definition) => definition.id === entry.id,
					),
				),
		).toBe(true);
		expect(
			catalog
				.filter((entry) => entry.kind === "template")
				.every((entry) =>
					registry.registry.templates.some(
						(definition) => definition.id === entry.id,
					),
				),
		).toBe(true);

		for (const entry of catalog.filter((value) => value.kind === "addon")) {
			const loaded = await loadAddonDefinition(entry.id);
			expect(loaded.addon.id).toBe(entry.id);
		}
	});
});
