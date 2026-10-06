import { isCancel, select } from "@clack/prompts";
import {
	resolveApiHost,
	rpcConsumer,
	rpcProviderError,
	rpcProviders,
} from "@ryuugg/generators";
import { Schema } from "effect";
import { cancel } from "../../utils/cancel";
import { availableChoice, type Choices } from "../../utils/choices";
import { listAnd } from "../../utils/list";
import { webAppLabels } from "../../utils/web-apps";
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

	dependencies: ["backend", "webApps"],

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

		const failure = rpcProviderError(config, id);
		if (failure !== undefined) throw failure;
	},

	async execute(config, interactive): Promise<typeof rpcSchema.Type | Skip> {
		if (!interactive) {
			const normalized = rpcProviders.normalize(config.rpc);
			if (normalized) return normalized;
			return SKIP;
		}

		const apps = webAppLabels(config);

		const rpc = await select({
			message:
				apps.length !== 0
					? `Do you want to use an RPC API with ${listAnd.format(apps)}?`
					: "Do you want to use an RPC API?",
			options: rpcOptions(rpcProviders),
		});

		if (isCancel(rpc)) cancel();
		if (rpc === "none") return SKIP;

		return rpc;
	},
});
