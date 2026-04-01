import { isCancel, select } from "@clack/prompts";
import { Schema } from "effect";
import { cancel } from "../../utils/cancel";
import { defineStep, SKIP, type Skip } from "../types";

const catalogOptions = ["Flat", "Scoped", "None"] as const;

type ValidCatalogs = Exclude<(typeof catalogOptions)[number], "None">;

const filteredOptions = catalogOptions.filter(
	(c): c is ValidCatalogs => c !== "None",
);

export const catalogsSchema = Schema.Literal(...filteredOptions);

type Catalogs = typeof catalogsSchema.Type;

export default defineStep<Catalogs>({
	id: "catalogs",
	group: "project",
	schema: catalogsSchema,

	dependencies: ["packageManager"],

	shouldRun: (config) => config.packageManager === "pnpm",

	async execute(_config, interactive): Promise<Catalogs | Skip> {
		if (!interactive) return SKIP;

		const catalogs = await select({
			message:
				"How do you want to manage dependency versions with pnpm Catalogs?",

			options: [
				{
					label: "Flat",
					value: "Flat" as const,
					hint: "single shared catalog for all deps",
				},
				{
					label: "Scoped",
					value: "Scoped" as const,
					hint: "grouped catalogs (catalog:dev, catalog:lint, ...)",
				},
				{
					label: "None",
					value: "None" as const,
					hint: "no catalogs, inline version strings",
				},
			],
		});

		if (isCancel(catalogs)) cancel();
		if (catalogs === "None") return SKIP;

		return catalogs;
	},
});
