import { isCancel, log, multiselect } from "@clack/prompts";
import { authMethods, resolveAuthMethods } from "@ryuujs/generators";
import { Result, Schema } from "effect";
import { cancel } from "../../utils/cancel";
import { choiceOptions, unsupportedMessage } from "../../utils/choices";
import { defineStep, SKIP } from "../types";

export const authMethodsSchema = Schema.NonEmptyArray(
	Schema.Literals(authMethods.ids),
).pipe(
	Schema.check(
		Schema.makeFilter((values) => {
			const unavailable = values.filter(
				(value) => !authMethods.available(value),
			);

			return unavailable.length === 0
				? undefined
				: unsupportedMessage(authMethods, unavailable);
		}),
	),
);

const authMethodsStep = defineStep<typeof authMethodsSchema.Type>({
	id: "authMethods",
	group: "auth",
	schema: authMethodsSchema,
	configKey: "authMethods",
	dependencies: ["authentication"],
	shouldRun: (config) => config.authentication === "better-auth",

	async execute(config, interactive) {
		if (!interactive) return SKIP;

		for (;;) {
			const selection = await multiselect({
				message: "How should people sign in?",
				required: true,
				options: choiceOptions(authMethods),
				initialValues: [...resolveAuthMethods(config)],
			});

			if (isCancel(selection)) cancel();

			const result = Schema.decodeUnknownResult(authMethodsSchema)(selection);
			if (Result.isSuccess(result)) return result.success;

			log.warn("Choose at least one supported sign-in method.");
		}
	},
});

export default authMethodsStep;
