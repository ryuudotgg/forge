import { isCancel, select } from "@clack/prompts";
import { z } from "zod";
import { cancel } from "../../utils/cancel";
import { stripNulls } from "../../utils/strip-nulls";
import { defineStep, SKIP } from "../types";

const styleFrameworkOptions = ["Tailwind CSS", "UnoCSS", "None"] as const;
export const styleFrameworkSchema = z.enum(
	styleFrameworkOptions.filter((framework) => framework !== "None"),
);

const styleFrameworkStep = defineStep<z.infer<typeof styleFrameworkSchema>>({
	id: "styleFramework",
	group: "style",
	schema: styleFrameworkSchema,
	configKey: "styleFramework",

	dependencies: ["tailwindEcosystem"],

	shouldRun: (config) => !!(config.web || config.desktop),

	async execute(config, interactive) {
		if (config.tailwindEcosystem === true) return "Tailwind CSS";

		if (!interactive) {
			const existing =
				typeof config.styleFramework === "string"
					? config.styleFramework
					: undefined;

			if (existing) {
				const result = styleFrameworkSchema.safeParse(existing);
				if (result.success) return result.data;
			}

			return SKIP;
		}

		const styleFramework = await select({
			message: `Which styling framework do you want to use for ${stripNulls([config.web, config.desktop]).join(" and ")}?`,
			options: styleFrameworkOptions.map((option) => ({
				label: option,
				value: option,
			})),
		});

		if (isCancel(styleFramework)) cancel();
		if (styleFramework === "None") return SKIP;

		return styleFramework;
	},
});

export default styleFrameworkStep;
