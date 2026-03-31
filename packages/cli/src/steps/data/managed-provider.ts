import { isCancel, select } from "@clack/prompts";
import { z } from "zod";
import { cancel } from "../../utils/cancel";
import { defineStep, SKIP } from "../types";

export const managedProviderSchema = z.enum([
	"PlanetScale",
	"Neon",
	"Nile",
	"Supabase",
	"Prisma Postgres",
	"Turso",
]);

const managedProviderStep = defineStep<z.infer<typeof managedProviderSchema>>({
	id: "managedProvider",
	group: "data",
	schema: managedProviderSchema,
	configKey: "managedProvider",

	dependencies: ["database", "orm"],

	shouldRun: (config) => !!config.database,

	async execute(config, interactive) {
		if (!interactive) {
			const existing =
				typeof config.managedProvider === "string"
					? config.managedProvider
					: undefined;

			if (existing) {
				const result = managedProviderSchema.safeParse(existing);
				if (result.success) return result.data;
			}

			return SKIP;
		}

		let options: string[];
		let message: string;

		switch (config.database) {
			case "MySQL": {
				options = ["PlanetScale", "None"];
				message = "Do you want a managed MySQL database?";
				break;
			}

			case "PostgreSQL": {
				options = [
					"PlanetScale",
					"Neon",
					"Nile",
					"Supabase",
					"Prisma Postgres",
					"None",
				].filter(
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

		const result = managedProviderSchema.safeParse(provider);
		if (!result.success) return SKIP;

		return result.data;
	},
});

export default managedProviderStep;
