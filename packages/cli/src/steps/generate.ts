import { NodeContext } from "@effect/platform-node";
import { run } from "@ryuujs/core";
import { type ForgeConfig, generators } from "@ryuujs/generators";
import { Effect } from "effect";
import type { PartialConfig } from "./types";
import { defineStep, SKIP } from "./types";

const generateStep = defineStep({
	id: "generate",
	group: "generate",
	schema: null,
	configKey: null,

	shouldRun: () => true,

	async execute(config: PartialConfig) {
		const projectRoot = String(config.path ?? ".");
		const forgeConfig: ForgeConfig = config;

		await Effect.runPromise(
			run(forgeConfig, generators, projectRoot).pipe(
				Effect.provide(NodeContext.layer),
			),
		);

		return SKIP;
	},
});

export default generateStep;
