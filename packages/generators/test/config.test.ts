import { describe, expect, it } from "vitest";
import {
	authenticationProviders,
	catalogs,
	databaseProviders,
	desktopFrameworks,
	linters,
	mobileFrameworks,
	nativeStyleFrameworks,
	orms,
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
	});
});
