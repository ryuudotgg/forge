import type { ForgeConfig } from "../config";
import { resolveDatabaseProvider } from "../data/providers";

export function trustedBuildDependencies(config: ForgeConfig): string[] {
	const names = ["esbuild", "lefthook", "msw", "sharp"];

	if (config.orm === "prisma") {
		names.push("@prisma/engines", "prisma");

		if (
			resolveDatabaseProvider(config).prisma.clientTemplate === "better-sqlite3"
		)
			names.push("better-sqlite3");
	}

	return names;
}
