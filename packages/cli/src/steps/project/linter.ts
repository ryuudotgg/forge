import { isCancel, select } from "@clack/prompts";
import { Either, Schema } from "effect";
import { cancel } from "../../utils/cancel";
import { defineStep, SKIP } from "../types";

const linterOptions = ["Biome", "Oxc", "ESLint + Prettier", "None"] as const;

type ValidLinter = Exclude<(typeof linterOptions)[number], "None">;

export const linterSchema = Schema.Literal(
	...linterOptions.filter((linter): linter is ValidLinter => linter !== "None"),
);

const linterStep = defineStep<typeof linterSchema.Type>({
	id: "linter",
	group: "project",
	schema: linterSchema,
	configKey: "linter",

	shouldRun: () => true,

	async execute(config, interactive) {
		if (!interactive) {
			if (config.linter) {
				const result = Schema.decodeUnknownEither(linterSchema)(config.linter);
				if (Either.isRight(result)) return result.right;
			}

			return SKIP;
		}

		const linter = await select({
			message: "What is your preferred linter/formatter?",
			options: linterOptions.map((option) => ({
				label: option,
				value: option,
			})),
		});

		if (isCancel(linter)) cancel();
		if (linter === "None") return SKIP;

		return linter;
	},
});

export default linterStep;
