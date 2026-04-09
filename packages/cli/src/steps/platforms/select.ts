import { isCancel, multiselect } from "@clack/prompts";
import {
	type Platform,
	platforms as platformChoices,
} from "@ryuujs/generators";
import { Either, Schema } from "effect";
import { cancel } from "../../utils/cancel";
import { defineStep, SKIP } from "../types";

const platformIds = platformChoices.ids as [Platform, ...Platform[]];
export const platformsSchema = Schema.NonEmptyArray(
	Schema.Literal(...platformIds),
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

		const selectedPlatforms = await multiselect({
			message: "What platforms do you want to support?",
			required: true,

			options: platformChoices.ids.map((platform) => ({
				label: platformChoices.label(platform),
				value: platform,
			})),
		});

		if (isCancel(selectedPlatforms)) cancel();

		const result =
			Schema.decodeUnknownEither(platformsSchema)(selectedPlatforms);

		if (Either.isLeft(result)) return SKIP;

		return result.right;
	},
});

export default platformsStep;
