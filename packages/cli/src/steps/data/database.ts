import { isCancel, select } from "@clack/prompts";
import { z } from "zod";
import { cancel } from "../../utils/cancel";
import { defineStep, SKIP } from "../types";

const databaseOptions = ["MySQL", "PostgreSQL", "SQLite", "None"] as const;
export const databaseSchema = z.enum(
	databaseOptions.filter((database) => database !== "None"),
);

const databaseStep = defineStep<z.infer<typeof databaseSchema>>({
	id: "database",
	group: "data",
	schema: databaseSchema,
	configKey: "database",

	shouldRun: (config) => !!config.backend && config.backend !== "Convex",

	async execute(config, interactive) {
		if (!interactive) {
			const existing =
				typeof config.database === "string" ? config.database : undefined;

			if (existing) {
				const result = databaseSchema.safeParse(existing);
				if (result.success) return result.data;
			}

			return SKIP;
		}

		const database = await select({
			message: "What is your preferred database?",
			options: databaseOptions.map((option) => ({
				label: option,
				value: option,
			})),
		});

		if (isCancel(database)) cancel();
		if (database === "None") return SKIP;

		return database;
	},
});

export default databaseStep;
