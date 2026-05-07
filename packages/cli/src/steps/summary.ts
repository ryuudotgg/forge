import { note } from "@clack/prompts";
import { NodeContext } from "@effect/platform-node";
import { CoreLive, Planner } from "@ryuujs/core";
import {
	type ForgeConfig,
	listVisibleAddons,
	loadDefinitionRegistry,
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
		const loadedRegistry = await loadDefinitionRegistry();
		const template = loadedRegistry.registry.templates.find((entry) =>
			entry.when(forgeConfig),
		);
		const framework = template
			? loadedRegistry.registry.frameworks.find(
					(entry) => entry.id === template.framework,
				)
			: undefined;
		const addons = (await listVisibleAddons())
			.filter((entry) =>
				loadedRegistry.registry.addons.some(
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
						loadedRegistry.registry,
					),
				).pipe(Effect.provide(coreLayer)),
			);

			const moduleRoots = Object.values(plan.manifest.modules)
				.map((record) => record.root)
				.filter((root): root is string => typeof root === "string");

			if (moduleRoots.length > 0)
				lines.push(formatLine("Modules", moduleRoots.join(", ")));
		} catch {}

		note(lines.join("\n"), "Forge Plan");
		return SKIP;
	},
});

export default summaryStep;
