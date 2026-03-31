import { isCancel, select } from "@clack/prompts";
import { Either, Schema } from "effect";
import { cancel } from "../../utils/cancel";
import { defineStep, SKIP } from "../types";

const authenticationOptions = [
	"Better Auth",
	"Auth.js",
	"WorkOS",
	"Clerk",
	"None",
] as const;

type ValidAuthentication = Exclude<
	(typeof authenticationOptions)[number],
	"None"
>;
const validAuthentications = authenticationOptions.filter(
	(x): x is ValidAuthentication => x !== "None",
);
export const authenticationSchema = Schema.Literal(...validAuthentications);

const authenticationStep = defineStep<typeof authenticationSchema.Type>({
	id: "authentication",
	group: "auth",
	schema: authenticationSchema,
	configKey: "authentication",

	shouldRun: () => true,

	async execute(config, interactive) {
		if (!interactive) {
			if (config.authentication) {
				const result = Schema.decodeUnknownEither(authenticationSchema)(
					config.authentication,
				);

				if (Either.isRight(result)) return result.right;
			}

			return SKIP;
		}

		const authentication = await select({
			message: "What is your preferred way to handle authentication?",
			options: authenticationOptions.map((option) => ({
				label: option,
				value: option,
			})),
		});

		if (isCancel(authentication)) cancel();
		if (authentication === "None") return SKIP;

		return authentication;
	},
});

export default authenticationStep;
