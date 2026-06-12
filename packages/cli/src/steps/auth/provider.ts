import { isCancel, log, select } from "@clack/prompts";
import { authenticationProviders } from "@ryuujs/generators";
import { Either, Schema } from "effect";
import { cancel } from "../../utils/cancel";
import {
	availableChoice,
	choiceOptions,
	unsupportedMessage,
} from "../../utils/choices";
import { defineStep, SKIP } from "../types";

export const authenticationSchema = Schema.Literal(
	...authenticationProviders.ids,
).pipe(Schema.filter(availableChoice(authenticationProviders)));

const authenticationStep = defineStep<typeof authenticationSchema.Type>({
	id: "authentication",
	group: "auth",
	schema: authenticationSchema,
	configKey: "authentication",

	dependencies: ["orm"],
	shouldRun: (config) => !!config.orm,

	async execute(config, interactive) {
		if (!interactive) {
			const normalized = authenticationProviders.normalize(
				config.authentication,
			);

			if (normalized) {
				const result =
					Schema.decodeUnknownEither(authenticationSchema)(normalized);

				if (Either.isRight(result)) return result.right;
			}

			return SKIP;
		}

		for (;;) {
			const authentication = await select({
				message: "What is your preferred way to handle authentication?",
				options: [
					...choiceOptions(authenticationProviders),
					{ label: "None", value: "none" as const },
				],
			});

			if (isCancel(authentication)) cancel();
			if (authentication === "none") return SKIP;

			if (authenticationProviders.available(authentication))
				return authentication;

			log.warn(unsupportedMessage(authenticationProviders, [authentication]));
		}
	},
});

export default authenticationStep;
