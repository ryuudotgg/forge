import { isCancel, log, select } from "@clack/prompts";
import {
	apiHostError,
	authenticationProviders,
	resolveApiHost,
} from "@ryuujs/generators";
import { Result, Schema } from "effect";
import { cancel } from "../../utils/cancel";
import {
	availableChoice,
	choiceOptions,
	unsupportedMessage,
} from "../../utils/choices";
import { defineStep, SKIP } from "../types";

export const authenticationSchema = Schema.Literals(
	authenticationProviders.ids,
).pipe(
	Schema.check(Schema.makeFilter(availableChoice(authenticationProviders))),
);

const authenticationStep = defineStep<typeof authenticationSchema.Type>({
	id: "authentication",
	group: "auth",
	schema: authenticationSchema,
	configKey: "authentication",

	dependencies: ["orm"],
	shouldRun: (config) =>
		!!config.orm &&
		config.backend !== "convex" &&
		(config.authentication !== undefined ||
			resolveApiHost(config) !== undefined),

	validate: (_value, config) => {
		const failure = apiHostError(config, {
			id: "better-auth",
			name: "Better Auth",
		});

		if (failure !== undefined) throw failure;
	},

	async execute(config, interactive) {
		if (!interactive) {
			const normalized = authenticationProviders.normalize(
				config.authentication,
			);

			if (normalized) {
				const result = Schema.decodeResult(authenticationSchema)(normalized);
				if (Result.isSuccess(result)) return result.success;
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
