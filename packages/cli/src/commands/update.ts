import { intro } from "@clack/prompts";
import { applyInstalledPlan, loadManagedProject } from "./lifecycle";

export async function runUpdate(
	_values: Record<string, string | boolean | undefined>,
) {
	intro("We're reconciling your installed addons and templates...");

	const project = await loadManagedProject(".", "update");
	await applyInstalledPlan(
		project.projectRoot,
		project.config,
		project.manifest.installs,
	);
}
