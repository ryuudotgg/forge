import { isCancel, select } from "@clack/prompts";
import { Either, Schema } from "effect";
import { cancel } from "../../utils/cancel";
import { defineStep, SKIP } from "../types";

const ormOptions = ["Drizzle ORM", "Prisma", "None"] as const;
type ValidOrm = Exclude<(typeof ormOptions)[number], "None">;
const validOrms = ormOptions.filter((x): x is ValidOrm => x !== "None");
export const ormSchema = Schema.Literal(...validOrms);

const ormStep = defineStep<typeof ormSchema.Type>({
	id: "orm",
	group: "data",
	schema: ormSchema,
	configKey: "orm",

	dependencies: ["database"],

	shouldRun: (config) => !!config.database,

	async execute(config, interactive) {
		if (!interactive) {
			if (config.orm) {
				const result = Schema.decodeUnknownEither(ormSchema)(config.orm);
				if (Either.isRight(result)) return result.right;
			}

			return SKIP;
		}

		const orm = await select({
			message: "What is your preferred ORM?",
			options: ormOptions.map((option) => ({
				label: option,
				value: option,
			})),
		});

		if (isCancel(orm)) cancel();
		if (orm === "None") return SKIP;

		return orm;
	},
});

export default ormStep;
