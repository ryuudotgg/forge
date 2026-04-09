import type { PartialConfig } from "../steps/types";

export const apiOnly: PartialConfig = {
	backend: "hono",
	rpc: "orpc",
	rpcPublic: true,
	database: "postgresql",
	orm: "drizzle",
	databaseProvider: "neon",
	linter: "biome",
	runtime: "Node.js",
	packageManager: "pnpm",
	catalogs: "scoped",
};
