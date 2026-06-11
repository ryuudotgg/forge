import { describe, expect, it } from "vitest";
import {
	getCatalogEntry,
	listCatalogEntries,
	listVisibleAddons,
	loadAddonDefinition,
	loadDefinitionRegistry,
	RegistryLoadError,
} from "../src/index";

const visibleAddonIds = [
	"better-auth",
	"biome",
	"commitlint",
	"drizzle",
	"github-ci",
	"gitignore",
	"lefthook",
	"pnpm",
	"prisma",
	"shared",
	"tailwind",
	"trpc",
	"typescript",
	"ui",
	"vscode",
	"yarn",
];

describe("catalog", () => {
	it("lists visible first-party addons only", async () => {
		const addons = await listVisibleAddons();

		expect(addons.map((entry) => entry.id).sort()).toEqual(visibleAddonIds);
		expect(addons.every((entry) => entry.kind === "addon")).toBe(true);
		expect(addons.every((entry) => entry.hidden === false)).toBe(true);
	});

	it("filters catalog entries by kind", async () => {
		const frameworks = await listCatalogEntries("framework");
		const templates = await listCatalogEntries("template");
		const addons = await listCatalogEntries("addon");

		expect(frameworks.map((entry) => entry.id)).toEqual(["nextjs"]);
		expect(templates.map((entry) => entry.id)).toEqual(["nextjs/base"]);
		expect(addons.every((entry) => entry.kind === "addon")).toBe(true);
		expect(frameworks.length + templates.length + addons.length).toBe(
			(await listCatalogEntries()).length,
		);
	});

	it("resolves catalog entries by id", async () => {
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

		expect(await getCatalogEntry("does-not-exist")).toBeUndefined();
	});

	it("keeps catalog ids unique across kinds", async () => {
		const ids = (await listCatalogEntries()).map((entry) => entry.id);

		expect(new Set(ids).size).toBe(ids.length);
	});

	it("returns a defensive copy of the catalog", async () => {
		const copy = await listCatalogEntries();
		const size = copy.length;

		copy.pop();

		expect(await listCatalogEntries()).toHaveLength(size);
	});

	it("throws a registry load error for an unknown addon", () => {
		expect(() => loadAddonDefinition("does-not-exist")).toThrow(
			RegistryLoadError,
		);
		expect(() => loadAddonDefinition("does-not-exist")).toThrow(
			"Addon Not Found: does-not-exist",
		);
	});

	it("keeps curated catalog entries aligned with loadable definitions", async () => {
		const catalog = await listCatalogEntries();
		const { registry } = await loadDefinitionRegistry();

		const catalogIds = (kind: "addon" | "framework" | "template") =>
			catalog
				.filter((entry) => entry.kind === kind)
				.map((entry) => entry.id)
				.sort();

		expect(catalogIds("framework")).toEqual(
			registry.frameworks.map((definition) => definition.id).sort(),
		);
		expect(catalogIds("template")).toEqual(
			registry.templates.map((definition) => definition.id).sort(),
		);
		expect(catalogIds("addon")).toEqual(
			registry.addons.map((definition) => definition.id).sort(),
		);

		for (const entry of catalog.filter((value) => value.kind === "addon")) {
			const loaded = await loadAddonDefinition(entry.id);

			expect(loaded.addon.id).toBe(entry.id);
			expect(loaded.catalogEntry).toBe(entry);
		}
	});
});
