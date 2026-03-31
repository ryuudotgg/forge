import { isCancel, select } from "@clack/prompts";
import { z } from "zod";
import { cancel } from "../../utils/cancel";
import { defineStep, SKIP, type Skip } from "../types";

const rpcOptions = ["tRPC", "oRPC", "None"] as const;

export const rpcSchema = z.enum(rpcOptions.filter((r) => r !== "None"));

type RPC = z.infer<typeof rpcSchema>;

export default defineStep<RPC>({
	id: "rpc",
	group: "backend",
	schema: rpcSchema,

	dependencies: ["backend"],

	shouldRun: (config) => !!config.backend && config.backend !== "Convex",

	async execute(config, interactive): Promise<RPC | Skip> {
		if (!interactive) return SKIP;

		const web = typeof config.web === "string" ? config.web : undefined;

		const rpc = await select({
			message: web
				? `Do you want to use an RPC API with ${web}?`
				: "Do you want to use an RPC API?",
			options: rpcOptions.map((r) => ({
				label: r,
				value: r,
			})),
		});

		if (isCancel(rpc)) cancel();
		if (rpc === "None") return SKIP;

		return rpc;
	},
});
