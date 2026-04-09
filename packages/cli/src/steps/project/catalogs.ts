import { isCancel, select } from "@clack/prompts";
import { catalogs as catalogChoices } from "@ryuujs/generators";
import { Schema } from "effect";
import { cancel } from "../../utils/cancel";
import { defineStep, SKIP, type Skip } from "../types";

const catalogOptions = [...catalogChoices.ids, "none"] as const;

type ValidCatalogs = Exclude<(typeof catalogOptions)[number], "none">;

const filteredOptions = catalogOptions.filter(
	(c): c is ValidCatalogs => c !== "none",
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
					label: catalogChoices.label("flat"),
					value: "flat" as const,
					hint: "single shared catalog for all deps",
				},
				{
					label: catalogChoices.label("scoped"),
					value: "scoped" as const,
					hint: "grouped catalogs (catalog:dev, catalog:lint, ...)",
				},
				{
					label: "None",
					value: "none" as const,
					hint: "no catalogs, inline version strings",
				},
			],
		});

		if (isCancel(catalogs)) cancel();
		if (catalogs === "none") return SKIP;

		return catalogs;
	},
});
