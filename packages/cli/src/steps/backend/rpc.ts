import { isCancel, select } from "@clack/prompts";
import {
	type RpcProvider,
	rpcProviders,
	webFrameworks,
} from "@ryuujs/generators";
import { Schema } from "effect";
import { cancel } from "../../utils/cancel";
import { defineStep, SKIP, type Skip } from "../types";

const rpcIds = rpcProviders.ids as [RpcProvider, ...RpcProvider[]];
export const rpcSchema = Schema.Literal(...rpcIds);

export default defineStep<typeof rpcSchema.Type>({
	id: "rpc",
	group: "backend",
	schema: rpcSchema,
	configKey: "rpc",

	dependencies: ["backend"],

	shouldRun: (config) => !!config.backend && config.backend !== "convex",

	async execute(config, interactive): Promise<typeof rpcSchema.Type | Skip> {
		if (!interactive) {
			const normalized = rpcProviders.normalize(config.rpc);
			if (normalized) return normalized;

			return SKIP;
		}

		const web = config.web;

		const rpc = await select({
			message: web
				? `Do you want to use an RPC API with ${webFrameworks.label(web)}?`
				: "Do you want to use an RPC API?",
			options: [
				...rpcProviders.ids.map((rpcProvider) => ({
					label: rpcProviders.label(rpcProvider),
					value: rpcProvider,
				})),
				{ label: "None", value: "none" as const },
			],
		});

		if (isCancel(rpc)) cancel();
		if (rpc === "none") return SKIP;

		return rpc;
	},
});
