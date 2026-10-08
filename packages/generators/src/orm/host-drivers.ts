import { ensuredModuleTarget, surfaceDependencies } from "@ryuugg/core";
import { apiHostFramework } from "../api-host";
import type { ForgeConfig } from "../config";
import { standaloneBackendInPlay } from "../registry/backends";
import { catalogRef, type VersionKey, versions } from "../versions";
import { primaryWebAppName } from "../web-apps";

function driverHostModule(config: ForgeConfig) {
	if (standaloneBackendInPlay(config) !== undefined) return "server";

	const host = apiHostFramework(config);
	return host === "react-router" || host === "tanstack-start"
		? primaryWebAppName(config)
		: undefined;
}

// Vite resolves SSR externals from the app root and tsdown inlines any package the server does not declare, so a native driver only packages/db declares loses its binding.
export function hostDriverDependencies(
	config: ForgeConfig,
	runtimeDeps: ReadonlyArray<VersionKey>,
) {
	const module = driverHostModule(config);
	const drivers = runtimeDeps.filter(
		(key) => "hostDependency" in versions[key],
	);

	if (module === undefined || drivers.length === 0) return [];

	return [
		surfaceDependencies(
			ensuredModuleTarget(module),
			"packageJson",
			drivers.map((key) => ({
				...catalogRef(key, config),
				type: "dependencies" as const,
			})),
		),
	];
}
