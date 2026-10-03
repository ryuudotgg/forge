import { isCancel, log, multiselect } from "@clack/prompts";
import { authMethods, resolveAuthMethods } from "@ryuugg/generators";
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

export function createAuthMethodsStep(options = { email: true }) {
	const schema = options.email
		? authMethodsSchema
		: authMethodsSchema.pipe(
				Schema.check(
					Schema.makeFilter((methods) =>
						methods.some(
							(method) => method === "email-otp" || method === "magic-link",
						)
							? "Email OTP and magic link aren't supported when adopting a project."
							: undefined,
					),
				),
			);

	return defineStep<typeof authMethodsSchema.Type>({
		id: "authMethods",
		group: "auth",
		schema,
		configKey: "authMethods",
		dependencies: ["authentication"],
		shouldRun: (config) => config.authentication === "better-auth",

		async execute(config, interactive) {
			if (!interactive) return SKIP;

			for (;;) {
				const selection = await multiselect({
					message: "How should people sign in?",
					required: true,
					options: choiceOptions(authMethods).filter(
						({ value }) =>
							options.email ||
							(value !== "email-otp" && value !== "magic-link"),
					),
					initialValues: [...resolveAuthMethods(config)],
				});

				if (isCancel(selection)) cancel();

				const result = Schema.decodeUnknownResult(schema)(selection);
				if (Result.isSuccess(result)) return result.success;

				log.warn("Choose at least one supported sign-in method.");
			}
		},
	});
}

export default createAuthMethodsStep();
