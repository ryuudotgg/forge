import { isCancel, select } from "@clack/prompts";
import { z } from "zod";
import { cancel } from "../../utils/cancel";
import { defineStep, SKIP } from "../types";

const authenticationOptions = [
	"Better Auth",
	"Auth.js",
	"WorkOS",
	"Clerk",
	"None",
] as const;

export const authenticationSchema = z.enum(
	authenticationOptions.filter((authentication) => authentication !== "None"),
);

const authenticationStep = defineStep<z.infer<typeof authenticationSchema>>({
	id: "authentication",
	group: "auth",
	schema: authenticationSchema,
	configKey: "authentication",

	shouldRun: () => true,

	async execute(config, interactive) {
		if (!interactive) {
			const existing =
				typeof config.authentication === "string"
					? config.authentication
					: undefined;

			if (existing) {
				const result = authenticationSchema.safeParse(existing);
				if (result.success) return result.data;
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
