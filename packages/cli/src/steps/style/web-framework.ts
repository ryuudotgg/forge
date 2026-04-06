import { isCancel, select } from "@clack/prompts";
import { Either, Schema } from "effect";
import { cancel } from "../../utils/cancel";
import { stripNulls } from "../../utils/strip-nulls";
import { defineStep, SKIP } from "../types";

const styleFrameworkOptions = ["Tailwind CSS", "UnoCSS", "None"] as const;
type ValidStyleFramework = Exclude<
	(typeof styleFrameworkOptions)[number],
	"None"
>;
const validStyleFrameworks = styleFrameworkOptions.filter(
	(x): x is ValidStyleFramework => x !== "None",
);
export const styleFrameworkSchema = Schema.Literal(...validStyleFrameworks);

const styleFrameworkStep = defineStep<typeof styleFrameworkSchema.Type>({
	id: "styleFramework",
	group: "style",
	schema: styleFrameworkSchema,
	configKey: "style",

	shouldRun: (config) => !!(config.web || config.desktop),

	async execute(config, interactive) {
		if (!interactive) {
			if (config.style) {
				const result = Schema.decodeUnknownEither(styleFrameworkSchema)(
					config.style,
				);

				if (Either.isRight(result)) return result.right;
			}

			return SKIP;
		}

		const styleFramework = await select({
			message: `Which styling framework do you want to use for ${stripNulls([config.web, config.desktop]).join(" and ")}?`,
			options: styleFrameworkOptions.map((option) => ({
				label: option,
				value: option,
			})),
		});

		if (isCancel(styleFramework)) cancel();
		if (styleFramework === "None") return SKIP;

		return styleFramework;
	},
});

export default styleFrameworkStep;
