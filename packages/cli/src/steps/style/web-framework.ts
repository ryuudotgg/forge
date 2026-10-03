import { isCancel, log, select } from "@clack/prompts";
import { desktopFrameworks, styleFrameworks } from "@ryuugg/generators";
import { Result, Schema } from "effect";
import { cancel } from "../../utils/cancel";
import {
	availableChoice,
	choiceOptions,
	unsupportedMessage,
} from "../../utils/choices";
import { listAnd } from "../../utils/list";
import { stripNulls } from "../../utils/strip-nulls";
import { webAppLabels } from "../../utils/web-apps";
import { defineStep, SKIP } from "../types";

export const styleFrameworkSchema = Schema.Literals(styleFrameworks.ids).pipe(
	Schema.check(Schema.makeFilter(availableChoice(styleFrameworks))),
);

const styleFrameworkStep = defineStep<typeof styleFrameworkSchema.Type>({
	id: "styleFramework",
	group: "style",
	schema: styleFrameworkSchema,
	configKey: "style",
	dependencies: ["webApps", "desktop"],

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
				message: `Which styling framework do you want to use for ${listAnd.format(
					stripNulls([
						...webAppLabels(config),
						config.desktop ? desktopFrameworks.label(config.desktop) : null,
					]),
				)}?`,
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
