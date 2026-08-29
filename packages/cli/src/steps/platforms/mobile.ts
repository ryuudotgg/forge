import { isCancel, log, select } from "@clack/prompts";
import { mobileFrameworks } from "@ryuujs/generators";
import { Schema } from "effect";
import { cancel } from "../../utils/cancel";
import {
	availableChoice,
	choiceOptions,
	unsupportedMessage,
} from "../../utils/choices";
import { defineStep, SKIP } from "../types";

export const mobileSchema = Schema.Literals(mobileFrameworks.ids).pipe(
	Schema.check(Schema.makeFilter(availableChoice(mobileFrameworks))),
);

const mobileStep = defineStep<typeof mobileSchema.Type>({
	id: "mobile",
	group: "platforms",
	schema: mobileSchema,
	configKey: "mobile",

	dependencies: ["platforms"],

	shouldRun: (config) => !!config.platforms?.includes("mobile"),

	async execute(config, interactive) {
		if (!interactive) {
			const normalized = mobileFrameworks.normalize(config.mobile);
			if (normalized === undefined) return "expo";
			return mobileFrameworks.available(normalized) ? normalized : SKIP;
		}

		for (;;) {
			const mobile = await select({
				message: "What is your preferred mobile framework?",
				options: choiceOptions(mobileFrameworks).map((option, index) =>
					index === 0
						? { ...option, label: `${option.label} (Recommended)` }
						: option,
				),
			});

			if (isCancel(mobile)) cancel();
			if (mobileFrameworks.available(mobile)) return mobile;

			log.warn(unsupportedMessage(mobileFrameworks, [mobile]));
		}
	},
});

export default mobileStep;
