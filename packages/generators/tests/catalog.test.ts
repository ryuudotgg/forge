import { deriveAddonFrameworks } from "@ryuujs/core";
import { describe, expect, it } from "vitest";
import {
	authenticationProviders,
	backends,
	builtins,
	getCatalogEntry,
	linters,
	listCatalogEntries,
	listVisibleAddons,
	loadAddonDefinition,
	loadDefinitionRegistry,
	RegistryLoadError,
	styleFrameworks,
	webFrameworks,
} from "../src/index";

const visibleAddonIds = [
	"better-auth",
	"biome",
	"bun",
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
	"vitest",
	"vscode",
	"worker",
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

		expect(frameworks.map((entry) => entry.id)).toEqual([
			"hono",
			"nextjs",
			"react-router",
			"tanstack-router",
			"tanstack-start",
			"convex",
			"elysia",
			"uwebsockets",
			"fastify",
			"express",
		]);
		expect(templates.map((entry) => entry.id)).toEqual([
			"hono/base",
			"nextjs/base",
			"react-router/base",
			"tanstack-router/base",
			"tanstack-start/base",
		]);
		expect(addons.every((entry) => entry.kind === "addon")).toBe(true);
		expect(frameworks.length + templates.length + addons.length).toBe(
			(await listCatalogEntries()).length,
		);
	});

	it("resolves catalog entries by id", async () => {
		expect(await getCatalogEntry("hono")).toMatchObject({
			category: "backend",
			id: "hono",
			kind: "framework",
		});
		expect(await getCatalogEntry("nextjs")).toMatchObject({ category: "web" });
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

	it("describes the Vitest addon", async () => {
		expect(await getCatalogEntry("vitest")).toMatchObject({
			experimental: false,
			hidden: false,
			id: "vitest",
			kind: "addon",
			name: "Vitest",
		});
	});

	it("derives adapter addon frameworks and slots from the registry", async () => {
		const serverFrameworks = [
			"nextjs",
			"react-router",
			"tanstack-start",
			"hono",
		];

		expect(await getCatalogEntry("trpc")).toMatchObject({
			frameworks: serverFrameworks,
			requiredSlots: ["trpc"],
		});
		expect(await getCatalogEntry("better-auth")).toMatchObject({
			frameworks: ["nextjs", "react-router", "tanstack-start", "hono"],
			requiredSlots: ["auth"],
		});
		expect(await getCatalogEntry("ui")).toMatchObject({
			frameworks: [
				"nextjs",
				"react-router",
				"tanstack-router",
				"tanstack-start",
			],
		});
	});

	it("preserves first-party support derivation under union semantics", () => {
		for (const addon of builtins.addons) {
			const adapterFrameworks = builtins.adapters
				.filter((adapter) => adapter.addon === addon.id)
				.map((adapter) => adapter.framework);
			const previousFrameworks =
				adapterFrameworks.length > 0
					? [...new Set(adapterFrameworks)]
					: addon.compatibility?.app?.frameworks;

			expect(deriveAddonFrameworks(addon, builtins.adapters), addon.id).toEqual(
				previousFrameworks,
			);
		}
	});

	it("derives announced entries from unavailable catalog-backed choices", async () => {
		const catalog = await listCatalogEntries();
		const mappings = [
			{
				category: "web",
				expectedIds: webFrameworks.ids.filter(
					(id) => !webFrameworks.available(id),
				),
				kind: "framework",
			},
			{
				category: "backend",
				expectedIds: backends.ids.filter((id) => !backends.available(id)),
				kind: "framework",
			},
			{
				category: "auth",
				expectedIds: authenticationProviders.ids.filter(
					(id) => !authenticationProviders.available(id),
				),
				kind: "addon",
			},
			{
				category: "style",
				expectedIds: styleFrameworks.ids.filter(
					(id) => !styleFrameworks.available(id),
				),
				kind: "addon",
			},
			{
				category: "linter",
				expectedIds: linters.ids.filter((id) => !linters.available(id)),
				kind: "addon",
			},
		];

		for (const mapping of mappings) {
			const announced = catalog.filter(
				(entry) =>
					!entry.available &&
					entry.kind === mapping.kind &&
					entry.category === mapping.category,
			);

			expect(announced.map((entry) => entry.id)).toEqual(mapping.expectedIds);
			expect(announced.every((entry) => entry.available === false)).toBe(true);
		}
	});

	it("marks every definition-backed entry as available", async () => {
		const catalog = await listCatalogEntries();
		const { registry } = await loadDefinitionRegistry();
		const definitionIds = new Set([
			...registry.addons.map((definition) => definition.id),
			...registry.frameworks.map((definition) => definition.id),
			...registry.templates.map((definition) => definition.id),
		]);

		for (const entry of catalog) {
			expect(entry.available, entry.id).toBe(definitionIds.has(entry.id));
		}
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
				.filter((entry) => entry.kind === kind && entry.available)
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

		for (const entry of catalog.filter(
			(value) => value.kind === "addon" && value.available,
		)) {
			const loaded = await loadAddonDefinition(entry.id);

			expect(loaded.addon.id).toBe(entry.id);
			expect(loaded.catalogEntry).toBe(entry);
		}
	});
});
