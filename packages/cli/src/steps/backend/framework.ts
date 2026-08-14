import { isCancel, log, select } from "@clack/prompts";
import { backends, resolveApiHost } from "@ryuujs/generators";
import { Schema } from "effect";
import { cancel } from "../../utils/cancel";
import {
	availableChoice,
	choiceOptions,
	unsupportedMessage,
} from "../../utils/choices";
import { defineStep, SKIP, type Skip } from "../types";

export const backendSchema = Schema.Literals(backends.ids).pipe(
	Schema.check(Schema.makeFilter(availableChoice(backends))),
);

export default defineStep<typeof backendSchema.Type>({
	id: "backend",
	group: "backend",
	schema: backendSchema,
	configKey: "backend",

	shouldRun: () => true,
	validate: (value, config) => {
		const normalized = backends.normalize(value);
		if (normalized !== undefined) config.backend = normalized;
	},

	async execute(
		config,
		interactive,
	): Promise<typeof backendSchema.Type | Skip> {
		if (!interactive) {
			const normalized = backends.normalize(config.backend);
			if (normalized && backends.available(normalized)) return normalized;

			return SKIP;
		}

		const recommended =
			resolveApiHost({ ...config, backend: "self" }) === "web"
				? "self"
				: "hono";

		for (;;) {
			const backend = await select({
				message: "What is your preferred backend framework?",
				options: [
					...choiceOptions(backends).map((option) =>
						recommended === option.value
							? { ...option, label: `${option.label} (Recommended)` }
							: option,
					),
					{ label: "None", value: "none" as const },
				],
			});

			if (isCancel(backend)) cancel();
			if (backend === "none") return SKIP;
			if (backends.available(backend)) return backend;

			log.warn(unsupportedMessage(backends, [backend]));
		}
	},
});
