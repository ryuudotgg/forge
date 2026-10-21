import { isCancel, select } from "@clack/prompts";
import { emailProviders, resolveApiHost } from "@ryuugg/generators";
import { Result, Schema } from "effect";
import { cancel } from "../../utils/cancel";
import { choiceOptions } from "../../utils/choices";
import { defineStep, SKIP } from "../types";

export const emailProviderSchema = Schema.Literals(emailProviders.ids);

const emailProviderStep = defineStep<typeof emailProviderSchema.Type>({
	id: "emailProvider",
	group: "backend",
	schema: emailProviderSchema,
	configKey: "emailProvider",
	shouldRun: (config) =>
		config.emailProvider !== undefined ||
		resolveApiHost(config, "api") !== undefined ||
		config.addons?.includes("worker") === true,
	async execute(config, interactive) {
		if (!interactive) {
			const normalized = emailProviders.normalize(config.emailProvider);
			if (normalized !== undefined) {
				const result = Schema.decodeResult(emailProviderSchema)(normalized);
				if (Result.isSuccess(result)) return result.success;
			}

			return SKIP;
		}

		const provider = await select({
			message: "Which email provider would you like to use?",
			options: [
				...choiceOptions(emailProviders),
				...(config.authentication === "better-auth" &&
				config.authMethods?.some(
					(method) => method === "email-otp" || method === "magic-link",
				)
					? []
					: [{ label: "None", value: "none" }]),
			],
		});

		if (isCancel(provider)) cancel();
		if (provider === "none") return SKIP;

		return emailProviders.normalize(provider) ?? SKIP;
	},
});

export default emailProviderStep;
