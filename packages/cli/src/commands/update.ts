import { intro } from "@clack/prompts";
import { applyInstalledPlan, loadManagedProject } from "./lifecycle";

export async function runUpdate(
	_values: Record<string, string | boolean | undefined>,
) {
	intro("We're updating your project...");

	const project = await loadManagedProject(".", "update");
	await applyInstalledPlan(
		project.projectRoot,
		project.config,
		project.manifest.installs,
	);
}
