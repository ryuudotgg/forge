import type { PartialConfig } from "../steps/types";

export const fullstack: PartialConfig = {
	platforms: ["Web", "Mobile"],
	web: "Next.js",
	mobile: "Expo",
	backend: "Next.js",
	rpc: "oRPC",
	database: "PostgreSQL",
	orm: "Drizzle ORM",
	managedProvider: "Neon",
	authentication: "Better Auth",
	tailwindEcosystem: true,
	styleFramework: "Tailwind CSS",
	nativeStyleFramework: "NativeWind",
	linter: "Biome",
	runtime: "Node.js",
	packageManager: "pnpm",
	catalogs: "Scoped",
};
