import { isCancel, log, select } from "@clack/prompts";
import { backends } from "@ryuujs/generators";
import { Schema } from "effect";
import { cancel } from "../../utils/cancel";
import {
	availableChoice,
	choiceOptions,
	unavailableMessage,
} from "../../utils/choices";
import { defineStep, SKIP, type Skip } from "../types";

export const backendSchema = Schema.Literal(...backends.ids).pipe(
	Schema.filter(availableChoice(backends)),
);

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
			if (normalized && backends.available(normalized)) return normalized;

			return SKIP;
		}

		const web = config.web;

		for (;;) {
			const backend = await select({
				message: "What is your preferred backend framework?",
				options: [
					...choiceOptions(backends).map((option) =>
						web === option.value
							? { ...option, label: `${option.label} (Recommended)` }
							: option,
					),
					{ label: "None", value: "none" as const },
				],
			});

			if (isCancel(backend)) cancel();
			if (backend === "none") return SKIP;
			if (backends.available(backend)) return backend;

			log.warn(unavailableMessage(backends, backend));
		}
	},
});
