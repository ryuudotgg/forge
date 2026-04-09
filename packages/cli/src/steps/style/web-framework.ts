import { isCancel, select } from "@clack/prompts";
import {
	desktopFrameworks,
	type StyleFramework,
	styleFrameworks,
	webFrameworks,
} from "@ryuujs/generators";
import { Either, Schema } from "effect";
import { cancel } from "../../utils/cancel";
import { stripNulls } from "../../utils/strip-nulls";
import { defineStep, SKIP } from "../types";

const styleFrameworkIds = styleFrameworks.ids as [
	StyleFramework,
	...StyleFramework[],
];

export const styleFrameworkSchema = Schema.Literal(...styleFrameworkIds);

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
				const result =
					Schema.decodeUnknownEither(styleFrameworkSchema)(normalized);

				if (Either.isRight(result)) return result.right;
			}

			return SKIP;
		}

		const styleFramework = await select({
			message: `Which styling framework do you want to use for ${stripNulls([
				config.web ? webFrameworks.label(config.web) : null,
				config.desktop ? desktopFrameworks.label(config.desktop) : null,
			]).join(" and ")}?`,
			options: [
				...styleFrameworks.ids.map((option) => ({
					label: styleFrameworks.label(option),
					value: option,
				})),
				{ label: "None", value: "none" as const },
			],
		});

		if (isCancel(styleFramework)) cancel();
		if (styleFramework === "none") return SKIP;

		return styleFramework;
	},
});

export default styleFrameworkStep;
