import { describe, expect, it } from "vitest";
import { backends, defineChoices } from "../src/config";
import {
	addonConfigBindings,
	authenticationProviders,
	catalogs,
	configWithInstall,
	configWithoutInstall,
	configWithSwitch,
	databaseProviders,
	databases,
	desktopFrameworks,
	installChange,
	linters,
	loadDefinitionRegistry,
	mobileFrameworks,
	nativeStyleFrameworks,
	optionalAddons,
	orms,
	platforms,
	recommendedAddons,
	rpcProviders,
	styleFrameworks,
	webFrameworks,
} from "../src/index";

describe("generator config choices", () => {
	it("folds compatibility characters and uppercase ids", () => {
		expect(backends.normalize("ΜWEBSOCKETS")).toBe("uwebsockets");
		expect(backends.normalize("µwebsockets")).toBe("uwebsockets");
		expect(webFrameworks.normalize("NEXTJS")).toBe("nextjs");
	});

	it("rejects collisions between different ids, labels and aliases", () => {
		expect(() => defineChoices({ web: "Web" })).not.toThrow();
		expect(() => defineChoices({ web: "Web", WEB: "Other" })).toThrow(
			"Choice Collision: web",
		);
		expect(() => defineChoices({ first: "Ｆoo", second: "foo" })).toThrow(
			"Choice Collision: foo",
		);
		expect(() =>
			defineChoices(
				{ first: "First", second: "Second" },
				{ aliases: { FIRST: "second" } },
			),
		).toThrow("Choice Collision: first");
		expect(
			defineChoices(
				{ first: "First" },
				{ aliases: { ALIAS: "first" } },
			).normalize("alias"),
		).toBe("first");
	});

	it("keeps user-facing labels correctly cased", () => {
		expect(webFrameworks.label("nextjs")).toBe("Next.js");
		expect(styleFrameworks.label("tailwind")).toBe("Tailwind CSS");
		expect(authenticationProviders.label("better-auth")).toBe("Better Auth");
		expect(orms.label("drizzle")).toBe("Drizzle ORM");
		expect(rpcProviders.label("trpc")).toBe("tRPC");

		expect(linters.label("biome")).toBe("Biome");
		expect(linters.available("oxc")).toBe(true);
		expect(addonConfigBindings.oxc).toEqual({ linter: "oxc" });
		expect(catalogs.label("scoped")).toBe("Scoped");
		expect(databaseProviders.label("prisma-postgres")).toBe("Prisma Postgres");

		expect(desktopFrameworks.label("electron")).toBe("Electron");
		expect(mobileFrameworks.label("react-native")).toBe("React Native");
		expect(nativeStyleFrameworks.label("nativewind")).toBe("NativeWind");

		expect(optionalAddons.label("github-ci")).toBe("GitHub CI");
		expect(optionalAddons.label("vitest")).toBe("Vitest");
		expect(optionalAddons.label("vscode")).toBe("VS Code");
	});

	it("normalizes legacy display values to canonical ids", () => {
		expect(webFrameworks.normalize("Next.js")).toBe("nextjs");
		expect(styleFrameworks.normalize("Tailwind CSS")).toBe("tailwind");
		expect(authenticationProviders.normalize("Better Auth")).toBe(
			"better-auth",
		);

		expect(orms.normalize("Drizzle ORM")).toBe("drizzle");
		expect(rpcProviders.normalize("tRPC")).toBe("trpc");
		expect(linters.normalize("Biome")).toBe("biome");
		expect(catalogs.normalize("Scoped")).toBe("scoped");
		expect(databaseProviders.normalize("Prisma Postgres")).toBe(
			"prisma-postgres",
		);

		expect(desktopFrameworks.normalize("Electron")).toBe("electron");
		expect(mobileFrameworks.normalize("React Native")).toBe("react-native");
		expect(nativeStyleFrameworks.normalize("NativeWind")).toBe("nativewind");

		expect(optionalAddons.normalize("GitHub CI")).toBe("github-ci");
		expect(optionalAddons.normalize("Vitest")).toBe("vitest");
		expect(optionalAddons.normalize("VS Code")).toBe("vscode");
	});

	it("only recommends known optional addons", () => {
		for (const addon of recommendedAddons)
			expect(optionalAddons.ids).toContain(addon);
	});

	it("marks roadmap-gated choices as unavailable", () => {
		expect(platforms.availableIds).toEqual(["web", "mobile"]);
		expect(platforms.available("desktop")).toBe(false);
		expect(mobileFrameworks.availableIds).toEqual(["expo"]);
		expect(mobileFrameworks.available("react-native")).toBe(false);

		expect(nativeStyleFrameworks.availableIds).toEqual(["nativewind"]);
		expect(nativeStyleFrameworks.available("nativewind")).toBe(true);
		expect(nativeStyleFrameworks.available("tamagui")).toBe(false);
		expect(nativeStyleFrameworks.available("unistyles")).toBe(false);
		expect(webFrameworks.availableIds).toEqual([
			"nextjs",
			"react-router",
			"tanstack-router",
			"tanstack-start",
		]);

		expect(authenticationProviders.availableIds).toEqual(["better-auth"]);
	});

	it("keeps ungated choice sets fully available", () => {
		expect(databases.availableIds).toEqual(databases.ids);
		for (const id of databases.ids) expect(databases.available(id)).toBe(true);
	});

	it("normalizes gated values independently of availability", () => {
		expect(authenticationProviders.normalize("Clerk")).toBe("clerk");
		expect(authenticationProviders.label("clerk")).toBe("Clerk");
		expect(authenticationProviders.available("clerk")).toBe(false);
	});
});

describe("install config reconciliation", () => {
	it("maps installed addons onto their config fields", () => {
		expect(configWithInstall({ slug: "acme" }, "prisma")).toEqual({
			orm: "prisma",
			slug: "acme",
		});

		expect(configWithInstall({ orm: "prisma" }, "better-auth")).toEqual({
			authentication: "better-auth",
			orm: "prisma",
		});

		expect(configWithInstall({}, "nativewind")).toEqual({
			nativeStyleFramework: "nativewind",
		});

		expect(configWithInstall({}, "trpc")).toEqual({ rpc: "trpc" });
	});

	it("keeps routing opt-in tooling addons through the addons list", () => {
		expect(configWithInstall({ slug: "acme" }, "commitlint")).toEqual({
			addons: ["commitlint"],
			slug: "acme",
		});

		expect(
			configWithoutInstall({ addons: ["commitlint"] }, "commitlint"),
		).toEqual({ addons: [] });
	});

	it("clears mapped config fields on removal", () => {
		expect(
			configWithoutInstall({ orm: "drizzle", slug: "acme" }, "drizzle"),
		).toEqual({ slug: "acme" });

		expect(
			configWithoutInstall(
				{ authentication: "better-auth", orm: "prisma" },
				"better-auth",
			),
		).toEqual({ orm: "prisma" });

		expect(
			configWithoutInstall({ emailProvider: "smtp", slug: "acme" }, "email"),
		).toEqual({ slug: "acme" });
	});

	it("keeps a mapped field that belongs to a different addon", () => {
		expect(configWithoutInstall({ orm: "prisma" }, "drizzle")).toEqual({
			orm: "prisma",
		});
	});

	it("leaves the config untouched when removing an unmapped addon", () => {
		expect(configWithoutInstall({ orm: "drizzle" }, "unknown")).toEqual({
			orm: "drizzle",
		});
	});

	it("flags installs that fight over the same config field", () => {
		const { addons } = loadDefinitionRegistry().registry;

		expect(installChange("prisma", ["drizzle", "trpc"], addons)).toEqual({
			_tag: "Blocked",
			holderId: "drizzle",
		});

		expect(installChange("drizzle", ["prisma"], addons)).toEqual({
			_tag: "Blocked",
			holderId: "prisma",
		});
	});

	it("allows re-adding the same addon and unrelated addons", () => {
		const { addons } = loadDefinitionRegistry().registry;

		expect(installChange("prisma", ["prisma"], addons)).toEqual({
			_tag: "Open",
		});

		expect(installChange("biome", ["biome"], addons)).toEqual({ _tag: "Open" });
		expect(installChange("tailwind", ["drizzle"], addons)).toEqual({
			_tag: "Open",
		});

		expect(installChange("commitlint", ["lefthook"], addons)).toEqual({
			_tag: "Open",
		});
	});

	it.each([
		["biome", "oxc"],
		["oxc", "biome"],
	])("switches %s over %s", (addonId, holderId) => {
		const { addons } = loadDefinitionRegistry().registry;

		expect(installChange(addonId, [holderId], addons)).toEqual({
			_tag: "Switch",
			holderId,
		});
	});

	it.each([
		{ requested: "oxc", holder: "biome" },
		{ requested: "biome", holder: "oxc" },
	])(
		"blocks $requested over $holder unless biome opts into switching",
		({ requested, holder }) => {
			const { addons } = loadDefinitionRegistry().registry;
			const withoutBiomeSwitching = addons.map((addon) =>
				addon.id === "biome" ? { ...addon, switching: undefined } : addon,
			);

			expect(installChange(requested, [holder], withoutBiomeSwitching)).toEqual(
				{ _tag: "Blocked", holderId: holder },
			);
		},
	);

	it.each([
		{ requested: "oxc", holder: "biome" },
		{ requested: "biome", holder: "oxc" },
	])(
		"blocks $requested over $holder unless oxc is exclusive",
		({ requested, holder }) => {
			const { addons } = loadDefinitionRegistry().registry;
			const nonExclusiveOxc = addons.map((addon) =>
				addon.id === "oxc" ? { ...addon, exclusive: false } : addon,
			);

			expect(installChange(requested, [holder], nonExclusiveOxc)).toEqual({
				_tag: "Blocked",
				holderId: holder,
			});
		},
	);

	it("switches the binding without changing other config fields", () => {
		expect(
			configWithSwitch(
				{ linter: "biome", orm: "drizzle", slug: "acme", addons: ["vscode"] },
				"biome",
				"oxc",
			),
		).toEqual({
			linter: "oxc",
			orm: "drizzle",
			slug: "acme",
			addons: ["vscode"],
		});
	});
});
