import { confirm, isCancel } from "@clack/prompts";
import { cancel } from "../../utils/cancel";
import { defineStep, SKIP } from "../types";

const installDepsStep = defineStep({
	id: "installDeps",
	group: "outro",
	schema: null,
	configKey: null,

	shouldRun: () => true,

	async execute(config, interactive) {
		const pm =
			typeof config.packageManager === "string"
				? config.packageManager
				: "pnpm";

		if (!interactive) {
			// TODO: Run `${pm} install`
			return SKIP;
		}

		const install = await confirm({
			message: `Do you want to install dependencies with ${pm}?`,
			active: "Yes",
			inactive: "No",
		});

		if (isCancel(install)) cancel();
		if (!install) return SKIP;

		// TODO: Run `${pm} install`
	},
});

export default installDepsStep;
