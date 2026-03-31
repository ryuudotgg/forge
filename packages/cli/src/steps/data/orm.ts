import { isCancel, select } from "@clack/prompts";
import { z } from "zod";
import { cancel } from "../../utils/cancel";
import { defineStep, SKIP } from "../types";

const ormOptions = ["Drizzle ORM", "Prisma", "None"] as const;
export const ormSchema = z.enum(ormOptions.filter((orm) => orm !== "None"));

const ormStep = defineStep<z.infer<typeof ormSchema>>({
	id: "orm",
	group: "data",
	schema: ormSchema,
	configKey: "orm",

	dependencies: ["database"],

	shouldRun: (config) => !!config.database,

	async execute(config, interactive) {
		if (!interactive) {
			const existing = typeof config.orm === "string" ? config.orm : undefined;

			if (existing) {
				const result = ormSchema.safeParse(existing);
				if (result.success) return result.data;
			}

			return SKIP;
		}

		const orm = await select({
			message: "What is your preferred ORM?",
			options: ormOptions.map((option) => ({
				label: option,
				value: option,
			})),
		});

		if (isCancel(orm)) cancel();
		if (orm === "None") return SKIP;

		return orm;
	},
});

export default ormStep;
