import { confirm, isCancel } from "@clack/prompts";
import { Schema } from "effect";
import { cancel } from "../../utils/cancel";
import { defineStep, SKIP, type Skip } from "../types";

export const publicRPCSchema = Schema.Boolean;

export default defineStep<boolean>({
	id: "rpcPublic",
	group: "backend",
	schema: publicRPCSchema,

	dependencies: ["rpc"],

	shouldRun: (config) => !!config.rpc,

	async execute(_config, interactive): Promise<boolean | Skip> {
		if (!interactive) return SKIP;

		const rpcPublic = await confirm({
			message: "Do you want your API to be publicly available?",
			active: "Yes (OpenAPI Specification)",
			inactive: "No",
			initialValue: false,
		});

		if (isCancel(rpcPublic)) cancel();

		return rpcPublic;
	},
});
