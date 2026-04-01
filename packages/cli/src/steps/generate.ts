import type { PartialConfig } from "./types";
import { defineStep } from "./types";

const generateStep = defineStep({
	id: "generate",
	group: "generate",
	schema: null,
	configKey: null,

	shouldRun: () => true,

	async execute(_config: PartialConfig) {
		// TODO: Implement
	},
});

export default generateStep;
