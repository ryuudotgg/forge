import { isCancel, log, select } from "@clack/prompts";
import { webFrameworks } from "@ryuujs/generators";
import { Either, Schema } from "effect";
import { cancel } from "../../utils/cancel";
import {
	availableChoice,
	choiceOptions,
	unsupportedMessage,
} from "../../utils/choices";
import { defineStep } from "../types";

export const webSchema = Schema.Literal(...webFrameworks.ids).pipe(
	Schema.filter(availableChoice(webFrameworks)),
);

const webStep = defineStep<typeof webSchema.Type>({
	id: "web",
	group: "platforms",
	schema: webSchema,
	configKey: "web",

	dependencies: ["platforms"],

	shouldRun: (config) => !!config.platforms?.includes("web"),

	async execute(config, interactive) {
		if (!interactive) {
			const normalized = webFrameworks.normalize(config.web);
			if (normalized) {
				const result = Schema.decodeUnknownEither(webSchema)(normalized);
				if (Either.isRight(result)) return result.right;
			}

			return "nextjs";
		}

		for (;;) {
			const web = await select({
				message: "What is your preferred web framework?",
				options: choiceOptions(webFrameworks).map((option, index) =>
					index === 0
						? { ...option, label: `${option.label} (Recommended)` }
						: option,
				),
			});

			if (isCancel(web)) cancel();
			if (webFrameworks.available(web)) return web;

			log.warn(unsupportedMessage(webFrameworks, [web]));
		}
	},
});

export default webStep;
