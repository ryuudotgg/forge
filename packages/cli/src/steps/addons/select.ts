import { confirm, isCancel } from "@clack/prompts";
import { cancel } from "../../utils/cancel";
import { defineStep, SKIP } from "../types";

const proceedToAddonsStep = defineStep<boolean>({
	id: "proceedToAddons",
	group: "addons",
	schema: null,
	configKey: null,

	shouldRun: () => true,

	async execute(_config, interactive) {
		if (!interactive) return SKIP;

		const proceedToAddons = await confirm({
			message: "Do you want to continue selecting addons?",
			active: "Yes (Recommended - Lengthy)",
			inactive: "No",
		});

		if (isCancel(proceedToAddons)) cancel();

		return proceedToAddons;
	},
});

export default proceedToAddonsStep;
