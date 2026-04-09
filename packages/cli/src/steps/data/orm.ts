import { isCancel, select } from "@clack/prompts";
import { type Orm, orms } from "@ryuujs/generators";
import { Either, Schema } from "effect";
import { cancel } from "../../utils/cancel";
import { defineStep, SKIP } from "../types";

const ormIds = orms.ids as [Orm, ...Orm[]];
export const ormSchema = Schema.Literal(...ormIds);

const ormStep = defineStep<typeof ormSchema.Type>({
	id: "orm",
	group: "data",
	schema: ormSchema,
	configKey: "orm",

	dependencies: ["database"],

	shouldRun: (config) => !!config.database,

	async execute(config, interactive) {
		if (!interactive) {
			const normalized = orms.normalize(config.orm);
			if (normalized) {
				const result = Schema.decodeUnknownEither(ormSchema)(normalized);
				if (Either.isRight(result)) return result.right;
			}

			return SKIP;
		}

		const orm = await select({
			message: "What is your preferred ORM?",
			options: [
				...orms.ids.map((option) => ({
					label: orms.label(option),
					value: option,
				})),
				{ label: "None", value: "none" as const },
			],
		});

		if (isCancel(orm)) cancel();
		if (orm === "none") return SKIP;

		return orm;
	},
});

export default ormStep;
