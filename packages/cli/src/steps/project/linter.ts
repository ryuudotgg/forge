import { isCancel, log, select } from "@clack/prompts";
import { linters } from "@ryuujs/generators";
import { Result, Schema } from "effect";
import { cancel } from "../../utils/cancel";
import {
	availableChoice,
	choiceOptions,
	unsupportedMessage,
} from "../../utils/choices";
import { defineStep, SKIP } from "../types";

export const linterSchema = Schema.Literals(linters.ids).pipe(
	Schema.check(Schema.makeFilter(availableChoice(linters))),
);

const linterStep = defineStep<typeof linterSchema.Type>({
	id: "linter",
	group: "project",
	schema: linterSchema,
	configKey: "linter",

	shouldRun: () => true,

	async execute(config, interactive) {
		if (!interactive) {
			const normalized = linters.normalize(config.linter);
			if (normalized) {
				const result = Schema.decodeResult(linterSchema)(normalized);
				if (Result.isSuccess(result)) return result.success;
			}

			return SKIP;
		}

		for (;;) {
			const linter = await select({
				message: "What is your preferred linter/formatter?",
				options: [
					...choiceOptions(linters),
					{ label: "None", value: "none" as const },
				],
			});

			if (isCancel(linter)) cancel();
			if (linter === "none") return SKIP;
			if (linters.available(linter)) return linter;

			log.warn(unsupportedMessage(linters, [linter]));
		}
	},
});

export default linterStep;
