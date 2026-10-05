import { apiHostFramework } from "../api-host";
import type { ForgeConfig } from "../config";
import { catalogRef, type VersionKey, versions } from "../versions";

// Vite resolves SSR externals from the app root at build time, so a native driver only packages/db declares is bundled and loses its binding.
export function viteHostDriverDependencies(
	config: ForgeConfig,
	runtimeDeps: ReadonlyArray<VersionKey>,
) {
	const host = apiHostFramework(config);
	if (host !== "react-router" && host !== "tanstack-start") return [];

	return runtimeDeps
		.filter((key) => "viteHostDependency" in versions[key])
		.map((key) => ({
			...catalogRef(key, config),
			type: "dependencies" as const,
		}));
}
