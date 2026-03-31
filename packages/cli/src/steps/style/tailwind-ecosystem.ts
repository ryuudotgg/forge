import { confirm, isCancel } from "@clack/prompts";
import { Schema } from "effect";
import { cancel } from "../../utils/cancel";
import { defineStep, SKIP } from "../types";

export const tailwindEcosystemSchema = Schema.Boolean;

const tailwindEcosystemStep = defineStep<boolean>({
	id: "tailwindEcosystem",
	group: "style",
	schema: tailwindEcosystemSchema,
	schemaDefault: () => false,
	configKey: "tailwindEcosystem",

	shouldRun: (config) => !!(config.web || config.desktop) && !!config.mobile,

	async execute(config, interactive) {
		if (!interactive) {
			if (config.tailwindEcosystem !== undefined)
				return config.tailwindEcosystem;

			return SKIP;
		}

		const tailwindEcosystem = await confirm({
			message: "Do you want to share Tailwind CSS across all platforms?",
			active: "Yes (Shared Styling)",
			inactive: "No (Independent Styling)",
		});

		if (isCancel(tailwindEcosystem)) cancel();

		return tailwindEcosystem;
	},
});

export default tailwindEcosystemStep;
