import { isCancel, log, multiselect } from "@clack/prompts";
import {
	type Platform,
	platforms as platformChoices,
} from "@ryuujs/generators";
import { Either, Schema } from "effect";
import { cancel } from "../../utils/cancel";
import { choiceOptions, unsupportedMessage } from "../../utils/choices";
import { defineStep, SKIP } from "../types";

export const platformsSchema = Schema.NonEmptyArray(
	Schema.Literal(...platformChoices.ids),
).pipe(
	Schema.filter((values) => {
		const unavailable = values.filter(
			(value) => !platformChoices.available(value),
		);

		return unavailable.length === 0
			? undefined
			: unsupportedMessage(platformChoices, unavailable);
	}),
);

const platformsStep = defineStep<typeof platformsSchema.Type>({
	id: "platforms",
	group: "platforms",
	schema: platformsSchema,
	configKey: "platforms",

	shouldRun: () => true,

	async execute(config, interactive) {
		if (!interactive) {
			if (Array.isArray(config.platforms)) {
				const normalized = config.platforms
					.map((platform) => platformChoices.normalize(platform))
					.filter((platform): platform is Platform => platform !== undefined);

				const result = Schema.decodeUnknownEither(platformsSchema)(normalized);
				if (Either.isRight(result)) return result.right;
			}

			return SKIP;
		}

		for (;;) {
			const selectedPlatforms = await multiselect({
				message: "What platforms do you want to support?",
				required: true,

				options: choiceOptions(platformChoices),
			});

			if (isCancel(selectedPlatforms)) cancel();

			const unavailable = selectedPlatforms.filter(
				(platform) => !platformChoices.available(platform),
			);

			if (unavailable.length > 0) {
				log.warn(unsupportedMessage(platformChoices, unavailable));
				continue;
			}

			const result =
				Schema.decodeUnknownEither(platformsSchema)(selectedPlatforms);

			if (Either.isLeft(result)) return SKIP;

			return result.right;
		}
	},
});

export default platformsStep;
