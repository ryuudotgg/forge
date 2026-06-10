import { isCancel, select } from "@clack/prompts";
import { linters } from "@ryuujs/generators";
import { Either, Schema } from "effect";
import { cancel } from "../../utils/cancel";
import { defineStep, SKIP } from "../types";

export const linterSchema = Schema.Literal(...linters.ids);

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
				const result = Schema.decodeUnknownEither(linterSchema)(normalized);
				if (Either.isRight(result)) return result.right;
			}

			return SKIP;
		}

		const linter = await select({
			message: "What is your preferred linter/formatter?",
			options: [
				...linters.ids.map((option) => ({
					label: linters.label(option),
					value: option,
				})),
				{ label: "None", value: "none" as const },
			],
		});

		if (isCancel(linter)) cancel();
		if (linter === "none") return SKIP;

		return linter;
	},
});

export default linterStep;
