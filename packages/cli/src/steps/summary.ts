import { note } from "@clack/prompts";
import { Planner, packageManagerCommand, runtimeCommand } from "@ryuujs/core";
import {
	type ForgeConfig,
	listVisibleAddons,
	loadDefinitionRegistry,
} from "@ryuujs/generators";
import { Cause, Effect, Exit, Option } from "effect";
import { runCliEffect } from "../runtime";
import { defineStep, SKIP } from "./types";

function formatLine(label: string, value: string) {
	return `${label}: ${value}`;
}

function summaryCommandVersions(config: ForgeConfig) {
	const runtime = runtimeCommand(config.runtime ?? "Node.js");
	const packageManager = packageManagerCommand(config.packageManager ?? "pnpm");

	return { node: "0", [packageManager]: "0", [runtime]: "0" };
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

		const planExit = await runCliEffect(
			Effect.gen(function* () {
				const planner = yield* Planner;
				return yield* planner.planCreate(
					String(forgeConfig.path ?? "."),
					forgeConfig,
					loadedRegistry.registry,
					summaryCommandVersions(forgeConfig),
				);
			}),
		);

		if (Exit.isSuccess(planExit)) {
			const plan = planExit.value;
			const moduleRoots = Object.values(plan.manifest.modules)
				.map((record) => record.root)
				.filter((root): root is string => typeof root === "string");

			if (moduleRoots.length > 0)
				lines.push(formatLine("Modules", moduleRoots.join(", ")));
		} else if (Option.isNone(Cause.failureOption(planExit.cause)))
			console.error(Cause.squash(planExit.cause));

		note(lines.join("\n"), "Forge Plan");
		return SKIP;
	},
});

export default summaryStep;
