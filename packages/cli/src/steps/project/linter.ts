import { isCancel, select } from "@clack/prompts";
import { z } from "zod";
import { cancel } from "../../utils/cancel";
import { defineStep, SKIP } from "../types";

const linterOptions = ["Biome", "Oxc", "ESLint + Prettier", "None"] as const;

export const linterSchema = z.enum(
	linterOptions.filter((linter) => linter !== "None"),
);

const linterStep = defineStep<z.infer<typeof linterSchema>>({
	id: "linter",
	group: "project",
	schema: linterSchema,
	configKey: "linter",

	shouldRun: () => true,

	async execute(config, interactive) {
		if (!interactive) {
			const existing =
				typeof config.linter === "string" ? config.linter : undefined;

			if (existing) {
				const result = linterSchema.safeParse(existing);
				if (result.success) return result.data;
			}

			return SKIP;
		}

		const linter = await select({
			message: "What is your preferred linter/formatter?",
			options: linterOptions.map((option) => ({
				label: option,
				value: option,
			})),
		});

		if (isCancel(linter)) cancel();
		if (linter === "None") return SKIP;

		return linter;
	},
});

export default linterStep;
