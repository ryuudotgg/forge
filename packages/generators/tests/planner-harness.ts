import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeContext } from "@effect/platform-node";
import {
	CommandProbe,
	ConfigStore,
	Planner,
	Renderer,
	State,
} from "@ryuujs/core";
import { Effect, Layer } from "effect";
import { builtins, type ForgeConfig } from "../src";

const commandProbeLayer = Layer.succeed(CommandProbe, {
	_tag: "CommandProbe",
	readVersion: () => Effect.succeed("1.0.0"),
});

const plannerBaseLayer = Layer.mergeAll(
	commandProbeLayer,
	ConfigStore.Default,
	Renderer.Default,
	State.Default,
);

const plannerLayer = Planner.Default.pipe(
	Layer.provideMerge(plannerBaseLayer),
	Layer.provideMerge(NodeContext.layer),
);

export async function plannedDefinitionIds(config: ForgeConfig) {
	const plan = await plannedProject(config);

	return [
		...new Set([
			...plan.manifest.installs.map((install) => install.definitionId),
			...Object.values(plan.manifest.modules).flatMap(
				(module) => module.definitionIds,
			),
		]),
	];
}

export async function plannedProject(config: ForgeConfig) {
	const directory = await mkdtemp(join(tmpdir(), "forge-generators-"));

	try {
		return await Effect.runPromise(
			Effect.flatMap(Planner, (planner) =>
				planner.planCreate(directory, config, builtins),
			).pipe(Effect.provide(plannerLayer)),
		);
	} finally {
		await rm(directory, { force: true, recursive: true });
	}
}
