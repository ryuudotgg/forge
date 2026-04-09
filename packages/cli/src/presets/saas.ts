import type { PartialConfig } from "../steps/types";

export const saas: PartialConfig = {
	platforms: ["web"],
	web: "nextjs",
	backend: "nextjs",
	rpc: "orpc",
	database: "postgresql",
	orm: "drizzle",
	databaseProvider: "neon",
	authentication: "better-auth",
	style: "tailwind",
	linter: "biome",
	runtime: "Node.js",
	packageManager: "pnpm",
	catalogs: "scoped",
};
