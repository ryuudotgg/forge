import { recommendedAddons } from "@ryuujs/generators";
import type { PartialConfig } from "../steps/types";

export const defaultPreset: PartialConfig = {
	addons: [...recommendedAddons],
	platforms: ["web"],
	web: "nextjs",
	backend: "nextjs",
	rpc: "trpc",
	database: "postgresql",
	orm: "drizzle",
	databaseProvider: "neon",
	authentication: "better-auth",
	style: "tailwind",
	uiLibrary: "base-ui",
	linter: "biome",
	runtime: "Node.js",
	packageManager: "pnpm",
	catalogs: "scoped",
};
