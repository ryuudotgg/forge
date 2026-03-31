import { isCancel, multiselect } from "@clack/prompts";
import { Either, Schema } from "effect";
import { cancel } from "../../utils/cancel";
import { defineStep, SKIP } from "../types";

const platformOptions = ["Web", "Desktop", "Mobile"] as const;
export const platformsSchema = Schema.NonEmptyArray(
	Schema.Literal(...platformOptions),
);

type Platforms = typeof platformsSchema.Type;

const platformsStep = defineStep<Platforms>({
	id: "platforms",
	group: "platforms",
	schema: platformsSchema,
	configKey: "platforms",

	shouldRun: () => true,

	async execute(config, interactive) {
		if (!interactive) {
			if (config.platforms) {
				const result = Schema.decodeUnknownEither(platformsSchema)(
					config.platforms,
				);

				if (Either.isRight(result)) return result.right;
			}

			return SKIP;
		}

		const platforms = await multiselect({
			message: "What platforms do you want to support?",
			required: true,

			options: platformOptions.map((platform) => ({
				label: platform,
				value: platform,
			})),
		});

		if (isCancel(platforms)) cancel();

		const result = Schema.decodeUnknownEither(platformsSchema)(platforms);
		if (Either.isLeft(result)) return SKIP;

		return result.right;
	},
});

export default platformsStep;
