import { confirm, isCancel } from "@clack/prompts";
import { Schema } from "effect";
import { cancel } from "../../utils/cancel";
import { defineStep, SKIP, type Skip } from "../types";

export const orpcContractsSchema = Schema.Boolean;

export default defineStep<boolean>({
	id: "orpcContracts",
	group: "backend",
	schema: orpcContractsSchema,

	dependencies: ["rpc"],

	shouldRun: (config) => config.rpc === "oRPC",

	async execute(_config, interactive): Promise<boolean | Skip> {
		if (!interactive) return SKIP;

		const orpcContracts = await confirm({
			message: "Do you want to use oRPC Contracts?",
			active: "Yes",
			inactive: "No",
		});

		if (isCancel(orpcContracts)) cancel();

		return orpcContracts;
	},
});
