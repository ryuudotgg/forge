import type { PartialConfig } from "../steps/types";

export const fullstack: PartialConfig = {
	platforms: ["Web", "Mobile"],
	web: "Next.js",
	mobile: "Expo",
	backend: "Next.js",
	rpc: "oRPC",
	database: "PostgreSQL",
	orm: "Drizzle ORM",
	databaseProvider: "Neon",
	authentication: "Better Auth",
	style: "Tailwind CSS",
	nativeStyleFramework: "NativeWind",
	linter: "Biome",
	runtime: "Node.js",
	packageManager: "pnpm",
	catalogs: "Scoped",
};
