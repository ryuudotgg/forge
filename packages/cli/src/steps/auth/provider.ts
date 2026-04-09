import { isCancel, select } from "@clack/prompts";
import {
	type AuthenticationProvider,
	authenticationProviders,
} from "@ryuujs/generators";
import { Either, Schema } from "effect";
import { cancel } from "../../utils/cancel";
import { defineStep, SKIP } from "../types";

const authenticationIds = authenticationProviders.ids as [
	AuthenticationProvider,
	...AuthenticationProvider[],
];

export const authenticationSchema = Schema.Literal(...authenticationIds);

const authenticationStep = defineStep<typeof authenticationSchema.Type>({
	id: "authentication",
	group: "auth",
	schema: authenticationSchema,
	configKey: "authentication",

	shouldRun: () => true,

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

		const authentication = await select({
			message: "What is your preferred way to handle authentication?",
			options: [
				...authenticationProviders.ids.map((option) => ({
					label: authenticationProviders.label(option),
					value: option,
				})),
				{ label: "None", value: "none" as const },
			],
		});

		if (isCancel(authentication)) cancel();
		if (authentication === "none") return SKIP;

		return authentication;
	},
});

export default authenticationStep;
