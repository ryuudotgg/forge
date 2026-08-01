import { intro, log } from "@clack/prompts";
import {
	applyInstalledPlan,
	loadManagedProject,
	loadProjectRegistry,
} from "./lifecycle";

export async function runUpdate(
	_values: Record<string, string | boolean | undefined>,
) {
	intro("We're reconciling your installed addons and templates...");

	const project = await loadManagedProject(".", "update");
	const loadedRegistry = await loadProjectRegistry(
		project.projectRoot,
		project.manifest.registries ?? [],
	);

	await applyInstalledPlan(
		project.projectRoot,
		project.config,
		project.manifest.installs,
		undefined,
		project.manifest.registries,
	);

	for (const descriptor of loadedRegistry.descriptors) {
		const previous = project.manifest.registryDescriptors?.find(
			(entry) => entry.id === descriptor.id,
		);

		if (previous !== undefined && previous.version !== descriptor.version)
			log.info(
				`${descriptor.id} ${previous.version} -> ${descriptor.version}.`,
			);
	}
}
