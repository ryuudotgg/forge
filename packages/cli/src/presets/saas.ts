import type { PartialConfig } from "../steps/types";

export const saas: PartialConfig = {
	platforms: ["Web"],
	web: "Next.js",
	backend: "Next.js",
	rpc: "oRPC",
	database: "PostgreSQL",
	orm: "Drizzle ORM",
	managedProvider: "Neon",
	authentication: "Better Auth",
	styleFramework: "Tailwind CSS",
	linter: "Biome",
	runtime: "Node.js",
	packageManager: "pnpm",
};
