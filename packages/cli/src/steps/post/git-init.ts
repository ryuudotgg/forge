import { confirm, isCancel } from "@clack/prompts";
import { cancel } from "../../utils/cancel";
import { defineStep, SKIP } from "../types";

const gitInitStep = defineStep({
	id: "gitInit",
	group: "outro",
	schema: null,
	configKey: null,

	shouldRun: () => true,

	async execute(_config, interactive) {
		if (!interactive) {
			// TODO: Initialize git repository
			return SKIP;
		}

		const gitInit = await confirm({
			message: "Do you want to initialize a git repository?",
			active: "Yes",
			inactive: "No",
		});

		if (isCancel(gitInit)) cancel();
		if (!gitInit) return SKIP;

		// TODO: Initialize git repository
	},
});

export default gitInitStep;
