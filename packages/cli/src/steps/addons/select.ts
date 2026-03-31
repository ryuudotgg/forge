import { confirm, isCancel } from "@clack/prompts";
import { cancel } from "../../utils/cancel";
import { defineStep } from "../types";

const proceedToAddonsStep = defineStep<boolean>({
	id: "proceedToAddons",
	group: "addons",
	schema: null,
	configKey: "proceedToAddons",

	shouldRun: () => true,

	async execute(_config, interactive) {
		if (!interactive) return false;

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
