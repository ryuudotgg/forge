import type { PartialConfig } from "../steps/types";

export const saas: PartialConfig = {
	platforms: ["Web"],
	web: "Next.js",
	backend: "Next.js",
	rpc: "oRPC",
	database: "PostgreSQL",
	orm: "Drizzle ORM",
	databaseProvider: "Neon",
	authentication: "Better Auth",
	style: "Tailwind CSS",
	linter: "Biome",
	runtime: "Node.js",
	packageManager: "pnpm",
	catalogs: "Scoped",
};
