import { isCancel, select } from "@clack/prompts";
import { backends } from "@ryuujs/generators";
import { Schema } from "effect";
import { cancel } from "../../utils/cancel";
import { defineStep, SKIP, type Skip } from "../types";

export const backendSchema = Schema.Literal(...backends.ids);

export default defineStep<typeof backendSchema.Type>({
	id: "backend",
	group: "backend",
	schema: backendSchema,
	configKey: "backend",

	shouldRun: () => true,

	async execute(
		config,
		interactive,
	): Promise<typeof backendSchema.Type | Skip> {
		if (!interactive) {
			const normalized = backends.normalize(config.backend);
			if (normalized) return normalized;

			return SKIP;
		}

		const web = config.web;

		const backend = await select({
			message: "What is your preferred backend framework?",
			options: [
				...backends.ids.map((backendId) => ({
					label:
						web === backendId
							? `${backends.label(backendId)} (Recommended)`
							: backends.label(backendId),
					value: backendId,
				})),
				{ label: "None", value: "none" as const },
			],
		});

		if (isCancel(backend)) cancel();
		if (backend === "none") return SKIP;

		return backend;
	},
});
