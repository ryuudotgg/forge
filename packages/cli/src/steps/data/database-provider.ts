import { isCancel, select } from "@clack/prompts";
import { Either, Schema } from "effect";
import { cancel } from "../../utils/cancel";
import { defineStep, SKIP } from "../types";

export const databaseProviderSchema = Schema.Literal(
	"PlanetScale",
	"Neon",
	"Nile",
	"Supabase",
	"Prisma Postgres",
	"Turso",
);

type DatabaseProvider = typeof databaseProviderSchema.Type;
type ProviderOption = DatabaseProvider | "None";

const databaseProviderStep = defineStep<DatabaseProvider>({
	id: "databaseProvider",
	group: "data",
	schema: databaseProviderSchema,
	configKey: "databaseProvider",

	dependencies: ["database", "orm"],

	shouldRun: (config) => !!config.database,

	async execute(config, interactive) {
		if (!interactive) {
			if (config.databaseProvider) {
				const result = Schema.decodeUnknownEither(databaseProviderSchema)(
					config.databaseProvider,
				);

				if (Either.isRight(result)) return result.right;
			}

			return SKIP;
		}

		let options: ProviderOption[];
		let message: string;

		switch (config.database) {
			case "MySQL": {
				options = ["PlanetScale", "None"];
				message = "Do you want a managed MySQL database?";
				break;
			}

			case "PostgreSQL": {
				const pgOptions: ProviderOption[] = [
					"PlanetScale",
					"Neon",
					"Nile",
					"Supabase",
					"Prisma Postgres",
					"None",
				];

				options = pgOptions.filter(
					(option) => config.orm === "Prisma" || option !== "Prisma Postgres",
				);

				message = "Do you want a managed PostgreSQL database?";

				break;
			}

			case "SQLite": {
				options = ["Turso", "None"];
				message = "Do you want a managed SQLite database?";
				break;
			}

			default:
				return SKIP;
		}

		const provider = await select({
			message,
			options: options.map((option) => ({
				label: option,
				value: option,
			})),
		});

		if (isCancel(provider)) cancel();
		if (provider === "None") return SKIP;

		return provider;
	},
});

export default databaseProviderStep;
