import { outro } from "@clack/prompts";
import { rainbow } from "../utils/rainbow";
import { defineStep, SKIP } from "./types";

const outroStep = defineStep({
	id: "outro",
	group: "outro",
	schema: null,
	configKey: null,

	shouldRun: () => true,

	async execute(_config, interactive) {
		if (!interactive) return SKIP;

		outro(`You've forged a ${rainbow("MYTHIC")} grade project!`);
	},
});

export default outroStep;
