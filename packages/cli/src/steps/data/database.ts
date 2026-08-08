import { isCancel, select } from "@clack/prompts";
import { databases } from "@ryuujs/generators";
import { Result, Schema } from "effect";
import { cancel } from "../../utils/cancel";
import { defineStep, SKIP } from "../types";

export const databaseSchema = Schema.Literals(databases.ids);

const databaseStep = defineStep<typeof databaseSchema.Type>({
	id: "database",
	group: "data",
	schema: databaseSchema,
	configKey: "database",

	shouldRun: (config) => !!config.backend && config.backend !== "convex",

	async execute(config, interactive) {
		if (!interactive) {
			const normalized = databases.normalize(config.database);
			if (normalized) {
				const result = Schema.decodeUnknownResult(databaseSchema)(normalized);
				if (Result.isSuccess(result)) return result.success;
			}

			return SKIP;
		}

		const database = await select({
			message: "What is your preferred database?",
			options: [
				...databases.ids.map((option) => ({
					label: databases.label(option),
					value: option,
				})),
				{ label: "None", value: "none" as const },
			],
		});

		if (isCancel(database)) cancel();
		if (database === "none") return SKIP;

		return database;
	},
});

export default databaseStep;
