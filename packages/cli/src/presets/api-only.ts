import type { PartialConfig } from "../steps/types";

export const apiOnly: PartialConfig = {
	backend: "Hono",
	rpc: "oRPC",
	rpcPublic: true,
	database: "PostgreSQL",
	orm: "Drizzle ORM",
	managedProvider: "Neon",
	linter: "Biome",
	runtime: "Node.js",
	packageManager: "pnpm",
	catalogs: "Scoped",
};
