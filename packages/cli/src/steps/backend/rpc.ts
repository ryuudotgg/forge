import { isCancel, select } from "@clack/prompts";
import {
	apiHostError,
	resolveApiHost,
	rpcConsumer,
	rpcProviders,
	webFrameworks,
} from "@ryuugg/generators";
import { Schema } from "effect";
import { cancel } from "../../utils/cancel";
import { availableChoice, type Choices } from "../../utils/choices";
import { defineStep, SKIP, type Skip } from "../types";

export const rpcSchema = Schema.Literals(rpcProviders.ids).pipe(
	Schema.check(Schema.makeFilter(availableChoice(rpcProviders))),
);

function rpcOptions<Id extends string>(
	providers: Choices<Id>,
): Array<{ label: string; value: Id | "none" }> {
	return [
		...providers.ids
			.filter((id) => providers.available(id))
			.map((id) => ({ label: providers.label(id), value: id })),
		{ label: "None", value: "none" },
	];
}

export default defineStep<typeof rpcSchema.Type>({
	id: "rpc",
	group: "backend",
	schema: rpcSchema,
	configKey: "rpc",

	dependencies: ["backend"],

	shouldRun: (config) =>
		config.backend !== "convex" &&
		(config.rpc !== undefined ||
			(!!config.backend &&
				rpcProviders.availableIds.some(
					(id) => resolveApiHost(config, rpcConsumer(id).slot) !== undefined,
				))),

	validate: (value, config) => {
		const id = rpcProviders.normalize(value);
		if (id === undefined) return;

		const failure = apiHostError(config, rpcConsumer(id));
		if (failure !== undefined) throw failure;
	},

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
			options: rpcOptions(rpcProviders),
		});

		if (isCancel(rpc)) cancel();
		if (rpc === "none") return SKIP;

		return rpc;
	},
});
