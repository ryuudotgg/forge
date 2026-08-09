import { isCancel, log, select } from "@clack/prompts";
import {
	desktopFrameworks,
	styleFrameworks,
	webFrameworks,
} from "@ryuujs/generators";
import { Result, Schema } from "effect";
import { cancel } from "../../utils/cancel";
import {
	availableChoice,
	choiceOptions,
	unsupportedMessage,
} from "../../utils/choices";
import { stripNulls } from "../../utils/strip-nulls";
import { defineStep, SKIP } from "../types";

export const styleFrameworkSchema = Schema.Literals(styleFrameworks.ids).pipe(
	Schema.check(Schema.makeFilter(availableChoice(styleFrameworks))),
);

const styleFrameworkStep = defineStep<typeof styleFrameworkSchema.Type>({
	id: "styleFramework",
	group: "style",
	schema: styleFrameworkSchema,
	configKey: "style",

	shouldRun: (config) => !!(config.web || config.desktop),

	async execute(config, interactive) {
		if (!interactive) {
			const normalized = styleFrameworks.normalize(config.style);
			if (normalized) {
				const result = Schema.decodeResult(styleFrameworkSchema)(normalized);
				if (Result.isSuccess(result)) return result.success;
			}

			return SKIP;
		}

		for (;;) {
			const styleFramework = await select({
				message: `Which styling framework do you want to use for ${stripNulls([
					config.web ? webFrameworks.label(config.web) : null,
					config.desktop ? desktopFrameworks.label(config.desktop) : null,
				]).join(" and ")}?`,
				options: [
					...choiceOptions(styleFrameworks),
					{ label: "None", value: "none" as const },
				],
			});

			if (isCancel(styleFramework)) cancel();
			if (styleFramework === "none") return SKIP;
			if (styleFrameworks.available(styleFramework)) return styleFramework;

			log.warn(unsupportedMessage(styleFrameworks, [styleFramework]));
		}
	},
});

export default styleFrameworkStep;
