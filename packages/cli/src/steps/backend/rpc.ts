import { isCancel, select } from "@clack/prompts";
import { Schema } from "effect";
import { cancel } from "../../utils/cancel";
import { defineStep, SKIP, type Skip } from "../types";

const rpcOptions = ["tRPC", "oRPC", "None"] as const;

type ValidRPC = Exclude<(typeof rpcOptions)[number], "None">;

const filteredRpcOptions = rpcOptions.filter(
	(r): r is ValidRPC => r !== "None",
);

export const rpcSchema = Schema.Literal(...filteredRpcOptions);

type RPC = typeof rpcSchema.Type;

export default defineStep<RPC>({
	id: "rpc",
	group: "backend",
	schema: rpcSchema,

	dependencies: ["backend"],

	shouldRun: (config) => !!config.backend && config.backend !== "Convex",

	async execute(config, interactive): Promise<RPC | Skip> {
		if (!interactive) return SKIP;

		const web = config.web;

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
