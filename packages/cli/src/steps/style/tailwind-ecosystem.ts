import { confirm, isCancel } from "@clack/prompts";
import { z } from "zod";
import { cancel } from "../../utils/cancel";
import { defineStep, SKIP } from "../types";

export const tailwindEcosystemSchema = z.boolean();

const tailwindEcosystemStep = defineStep<boolean>({
	id: "tailwindEcosystem",
	group: "style",
	schema: tailwindEcosystemSchema,
	configKey: "tailwindEcosystem",

	shouldRun: (config) => !!(config.web || config.desktop) && !!config.mobile,

	async execute(config, interactive) {
		if (!interactive) {
			const existing = config.tailwindEcosystem;

			if (typeof existing === "boolean") return existing;

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
