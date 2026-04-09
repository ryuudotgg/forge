import type { PartialConfig } from "../steps/types";

export const fullstack: PartialConfig = {
	platforms: ["web", "mobile"],
	web: "nextjs",
	mobile: "expo",
	backend: "nextjs",
	rpc: "orpc",
	database: "postgresql",
	orm: "drizzle",
	databaseProvider: "neon",
	authentication: "better-auth",
	style: "tailwind",
	nativeStyleFramework: "nativewind",
	linter: "biome",
	runtime: "Node.js",
	packageManager: "pnpm",
	catalogs: "scoped",
};
