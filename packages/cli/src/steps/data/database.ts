import { isCancel, select } from "@clack/prompts";
import { type Database, databases } from "@ryuujs/generators";
import { Either, Schema } from "effect";
import { cancel } from "../../utils/cancel";
import { defineStep, SKIP } from "../types";

const databaseIds = databases.ids as [Database, ...Database[]];
export const databaseSchema = Schema.Literal(...databaseIds);

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
				const result = Schema.decodeUnknownEither(databaseSchema)(normalized);
				if (Either.isRight(result)) return result.right;
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
