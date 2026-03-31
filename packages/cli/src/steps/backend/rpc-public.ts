import { confirm, isCancel } from "@clack/prompts";
import { z } from "zod";
import { cancel } from "../../utils/cancel";
import { defineStep, SKIP, type Skip } from "../types";

export const publicRPCSchema = z.boolean();

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
		});

		if (isCancel(rpcPublic)) cancel();

		return rpcPublic;
	},
});
