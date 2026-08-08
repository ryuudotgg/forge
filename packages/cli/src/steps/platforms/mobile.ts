import { isCancel, select } from "@clack/prompts";
import { mobileFrameworks } from "@ryuujs/generators";
import { Result, Schema } from "effect";
import { cancel } from "../../utils/cancel";
import { defineStep } from "../types";

const mobileOptions = mobileFrameworks.ids;
export const mobileSchema = Schema.Literals(mobileOptions);

const mobileStep = defineStep<typeof mobileSchema.Type>({
	id: "mobile",
	group: "platforms",
	schema: mobileSchema,
	configKey: "mobile",

	dependencies: ["platforms"],

	shouldRun: (config) => !!config.platforms?.includes("mobile"),

	async execute(config, interactive) {
		if (!interactive) {
			if (config.mobile) {
				const result = Schema.decodeUnknownResult(mobileSchema)(config.mobile);
				if (Result.isSuccess(result)) return result.success;
			}

			return "expo";
		}

		const mobile = await select({
			message: "What is your preferred mobile framework?",
			options: mobileOptions.map((option, index) => ({
				label:
					index === 0
						? `${mobileFrameworks.label(option)} (Recommended)`
						: mobileFrameworks.label(option),
				value: option,
			})),
		});

		if (isCancel(mobile)) cancel();

		return mobile;
	},
});

export default mobileStep;
