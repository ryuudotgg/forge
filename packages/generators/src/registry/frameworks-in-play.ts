import type { FrameworkDefinition } from "@ryuujs/core";
import type { ForgeConfig } from "../config";

function frameworkFor(
	frameworks: ReadonlyArray<FrameworkDefinition>,
	id: string,
) {
	const framework = frameworks.find((entry) => entry.id === id);
	if (!framework) throw new Error(`Framework Definition Missing: ${id}`);

	return framework;
}

export function frameworksInPlay(
	config: ForgeConfig,
	frameworks: ReadonlyArray<FrameworkDefinition>,
): ReadonlyArray<FrameworkDefinition> {
	const ids = [config.web];
	return ids.flatMap((id) =>
		id === undefined ? [] : [frameworkFor(frameworks, id)],
	);
}

export function frameworkBuildOutputs(
	frameworks: ReadonlyArray<FrameworkDefinition>,
): ReadonlyArray<string> {
	return [
		...new Set(frameworks.flatMap((framework) => framework.buildOutputs)),
	];
}

export function frameworkIgnoreDirs(
	frameworks: ReadonlyArray<FrameworkDefinition>,
): ReadonlyArray<string> {
	return frameworks.flatMap((framework) => framework.ignoreDirs);
}

export function frameworkTsconfigPresets(
	frameworks: ReadonlyArray<FrameworkDefinition>,
): ReadonlyArray<FrameworkDefinition["tsconfigPreset"]> {
	const presets = new Map<string, FrameworkDefinition["tsconfigPreset"]>();
	for (const framework of frameworks)
		if (!presets.has(framework.tsconfigPreset.name))
			presets.set(framework.tsconfigPreset.name, framework.tsconfigPreset);

	return [...presets.values()];
}
