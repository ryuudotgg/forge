import { isCancel, select } from "@clack/prompts";
import { type WebFramework, webFrameworks } from "@ryuujs/generators";
import { Either, Schema } from "effect";
import { cancel } from "../../utils/cancel";
import { defineStep } from "../types";

const webIds = webFrameworks.ids as [WebFramework, ...WebFramework[]];
export const webSchema = Schema.Literal(...webIds);

const webStep = defineStep<typeof webSchema.Type>({
	id: "web",
	group: "platforms",
	schema: webSchema,
	configKey: "web",

	dependencies: ["platforms"],

	shouldRun: (config) => !!config.platforms?.includes("web"),

	async execute(config, interactive) {
		if (!interactive) {
			const normalized = webFrameworks.normalize(config.web);
			if (normalized) {
				const result = Schema.decodeUnknownEither(webSchema)(normalized);
				if (Either.isRight(result)) return result.right;
			}

			return "nextjs";
		}

		const web = await select({
			message: "What is your preferred web framework?",
			options: webFrameworks.ids.map((option, index) => ({
				label:
					index === 0
						? `${webFrameworks.label(option)} (Recommended)`
						: webFrameworks.label(option),
				value: option,
			})),
		});

		if (isCancel(web)) cancel();

		return web;
	},
});

export default webStep;
