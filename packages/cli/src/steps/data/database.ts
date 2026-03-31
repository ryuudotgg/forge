import { isCancel, select } from "@clack/prompts";
import { Either, Schema } from "effect";
import { cancel } from "../../utils/cancel";
import { defineStep, SKIP } from "../types";

const databaseOptions = ["MySQL", "PostgreSQL", "SQLite", "None"] as const;
type ValidDatabase = Exclude<(typeof databaseOptions)[number], "None">;
const validDatabases = databaseOptions.filter(
	(x): x is ValidDatabase => x !== "None",
);
export const databaseSchema = Schema.Literal(...validDatabases);

const databaseStep = defineStep<typeof databaseSchema.Type>({
	id: "database",
	group: "data",
	schema: databaseSchema,
	configKey: "database",

	shouldRun: (config) => !!config.backend && config.backend !== "Convex",

	async execute(config, interactive) {
		if (!interactive) {
			if (config.database) {
				const result = Schema.decodeUnknownEither(databaseSchema)(
					config.database,
				);

				if (Either.isRight(result)) return result.right;
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
