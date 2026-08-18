import { isDeepStrictEqual } from "node:util";
import type { FrameworkDefinition } from "@ryuujs/core";
import { type ForgeConfig, hasAddon } from "../config";
import { standaloneBackendInPlay } from "./backends";

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
	const ids = new Set(
		[
			config.web,
			standaloneBackendInPlay(config),
			hasAddon(config, "worker") ? "hono" : undefined,
		].filter((id) => id !== undefined),
	);

	return [...ids].map((id) => frameworkFor(frameworks, id));
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
	const presets = new Map<
		string,
		{
			readonly framework: FrameworkDefinition;
			readonly preset: FrameworkDefinition["tsconfigPreset"];
		}
	>();

	for (const framework of frameworks) {
		const preset = framework.tsconfigPreset;
		const existing = presets.get(preset.name);
		if (!existing) {
			presets.set(preset.name, { framework, preset });
			continue;
		}

		if (!isDeepStrictEqual(existing.preset.content, preset.content))
			throw new Error(
				`TypeScript Preset Conflict: ${preset.name} is defined differently by ${existing.framework.id} and ${framework.id}`,
			);
	}

	return [...presets.values()].map(({ preset }) => preset);
}
