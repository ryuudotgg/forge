import { basename } from "node:path";
import type { ForgeConfig } from "@ryuugg/generators";
import type { ManagedProject } from "./lifecycle";

export function secondaryAppModules(
	project: ManagedProject,
	app: NonNullable<ForgeConfig["webApps"]>[number],
) {
	const root = `apps/${app.name}`;
	const compatibleModules = project.modules.filter(
		(module) => module.type === "app" && module.framework === app.framework,
	);

	const identifiedModules = compatibleModules.filter(
		(module) =>
			module.root === root ||
			module.packageName === `@${project.config.slug}/${app.name}` ||
			project.manifest.modules[module.id]?.root === root,
	);

	if (identifiedModules.length > 0) return identifiedModules;

	return compatibleModules.filter(
		(module) =>
			basename(project.manifest.modules[module.id]?.root ?? module.root) ===
				app.name || module.packageName?.split("/").at(-1) === app.name,
	);
}
