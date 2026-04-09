import { note } from "@clack/prompts";
import { NodeContext } from "@effect/platform-node";
import { CoreLive, Planner } from "@ryuujs/core";
import {
	builtins,
	type ForgeConfig,
	getCatalogEntry,
	listVisibleAddons,
} from "@ryuujs/generators";
import { Effect, Layer } from "effect";
import { defineStep, SKIP } from "./types";

const coreLayer = CoreLive.pipe(Layer.provideMerge(NodeContext.layer));

function formatLine(label: string, value: string) {
	return `${label}: ${value}`;
}

const summaryStep = defineStep({
	id: "summary",
	group: "generate",
	schema: null,
	configKey: null,

	shouldRun: () => true,

	async execute(config, interactive) {
		if (!interactive) return SKIP;

		const forgeConfig: ForgeConfig = config;
		const template = builtins.templates.find((entry) =>
			entry.when(forgeConfig),
		);
		const framework = template
			? builtins.frameworks.find((entry) => entry.id === template.framework)
			: undefined;
		const addons = listVisibleAddons()
			.filter((entry) =>
				builtins.addons.some(
					(definition) =>
						definition.id === entry.id && definition.when(forgeConfig),
				),
			)
			.map((entry) => entry.name);

		const lines = [
			formatLine("Framework", framework?.name ?? "None"),
			formatLine("Template", template?.name ?? "None"),
			formatLine("Addons", addons.length > 0 ? addons.join(", ") : "None"),
		];

		try {
			const plan = await Effect.runPromise(
				Effect.flatMap(Planner, (planner) =>
					planner.planCreate(
						String(forgeConfig.path ?? "."),
						forgeConfig,
						builtins,
					),
				).pipe(Effect.provide(coreLayer)),
			);

			const moduleRoots = Object.values(plan.manifest.modules)
				.map((record) => record.root)
				.filter((root): root is string => typeof root === "string");

			if (moduleRoots.length > 0)
				lines.push(formatLine("Modules", moduleRoots.join(", ")));
		} catch {
			const catalogTemplate = template
				? getCatalogEntry(template.id)
				: undefined;
			if (catalogTemplate?.kind === "template")
				lines[1] = formatLine("Template", catalogTemplate.name);
		}

		note(lines.join("\n"), "Forge Plan");
		return SKIP;
	},
});

export default summaryStep;
