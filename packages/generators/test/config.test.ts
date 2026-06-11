import { describe, expect, it } from "vitest";
import {
	authenticationProviders,
	catalogs,
	configWithInstall,
	configWithoutInstall,
	databaseProviders,
	desktopFrameworks,
	installConflict,
	linters,
	mobileFrameworks,
	nativeStyleFrameworks,
	optionalAddons,
	orms,
	recommendedAddons,
	rpcProviders,
	styleFrameworks,
	webFrameworks,
} from "../src/index";

describe("generator config choices", () => {
	it("keeps user-facing labels correctly cased", () => {
		expect(webFrameworks.label("nextjs")).toBe("Next.js");
		expect(styleFrameworks.label("tailwind")).toBe("Tailwind CSS");
		expect(authenticationProviders.label("better-auth")).toBe("Better Auth");
		expect(orms.label("drizzle")).toBe("Drizzle ORM");
		expect(rpcProviders.label("trpc")).toBe("tRPC");
		expect(linters.label("biome")).toBe("Biome");
		expect(catalogs.label("scoped")).toBe("Scoped");
		expect(databaseProviders.label("prisma-postgres")).toBe("Prisma Postgres");
		expect(desktopFrameworks.label("electron")).toBe("Electron");
		expect(mobileFrameworks.label("react-native")).toBe("React Native");
		expect(nativeStyleFrameworks.label("nativewind")).toBe("NativeWind");
		expect(optionalAddons.label("github-ci")).toBe("GitHub CI");
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
		expect(optionalAddons.normalize("VS Code")).toBe("vscode");
	});

	it("only recommends known optional addons", () => {
		for (const addon of recommendedAddons)
			expect(optionalAddons.ids).toContain(addon);
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
		expect(installConflict("prisma", ["drizzle", "trpc"])).toBe("drizzle");
		expect(installConflict("drizzle", ["prisma"])).toBe("prisma");
	});

	it("allows re-adding the same addon and unrelated addons", () => {
		expect(installConflict("prisma", ["prisma"])).toBe(undefined);
		expect(installConflict("tailwind", ["drizzle"])).toBe(undefined);
		expect(installConflict("commitlint", ["lefthook"])).toBe(undefined);
	});
});
