import { isCancel, select } from "@clack/prompts";
import { databaseProviders } from "@ryuujs/generators";
import { Either, Schema } from "effect";
import { cancel } from "../../utils/cancel";
import { defineStep, SKIP } from "../types";

export const databaseProviderSchema = Schema.Literal(...databaseProviders.ids);

type DatabaseProvider = typeof databaseProviderSchema.Type;
type ProviderOption = DatabaseProvider | "none";

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
			case "mysql": {
				options = ["planetscale", "none"];
				message = "Do you want a managed MySQL database?";
				break;
			}

			case "postgresql": {
				const pgOptions: ProviderOption[] = [
					"planetscale",
					"neon",
					"nile",
					"supabase",
					"prisma-postgres",
					"none",
				];

				options = pgOptions.filter(
					(option) => config.orm === "prisma" || option !== "prisma-postgres",
				);

				message = "Do you want a managed PostgreSQL database?";

				break;
			}

			case "sqlite": {
				options = ["turso", "none"];
				message = "Do you want a managed SQLite database?";
				break;
			}

			default:
				return SKIP;
		}

		const provider = await select({
			message,
			options: options.map((option) => ({
				label: option === "none" ? "None" : databaseProviders.label(option),
				value: option,
			})),
		});

		if (isCancel(provider)) cancel();
		if (provider === "none") return SKIP;

		return provider;
	},
});

export default databaseProviderStep;
