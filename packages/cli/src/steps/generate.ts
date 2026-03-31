import type { PartialConfig } from "./types";
import { defineStep } from "./types";

const generateStep = defineStep({
	id: "generate",
	group: "generate",
	schema: null,
	configKey: null,

	shouldRun: () => true,

	async execute(config: PartialConfig) {
		console.log(config);

		// TODO: Generate the Project
	},
});

export default generateStep;
