import type { PartialConfig } from "../steps/types";

export const defaultPreset: PartialConfig = {
	platforms: ["web"],
	web: "nextjs",
	backend: "nextjs",
	rpc: "trpc",
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
