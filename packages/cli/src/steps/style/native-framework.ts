import { isCancel, select } from "@clack/prompts";
import { mobileFrameworks, nativeStyleFrameworks } from "@ryuujs/generators";
import { Either, Schema } from "effect";
import { cancel } from "../../utils/cancel";
import { defineStep, SKIP } from "../types";

const nativeStyleFrameworkOptions = [
	...nativeStyleFrameworks.ids,
	"none",
] as const;

type ValidNativeStyleFramework = Exclude<
	(typeof nativeStyleFrameworkOptions)[number],
	"none"
>;
const validNativeStyleFrameworks = nativeStyleFrameworkOptions.filter(
	(x): x is ValidNativeStyleFramework => x !== "none",
);
export const nativeStyleFrameworkSchema = Schema.Literal(
	...validNativeStyleFrameworks,
);

const nativeStyleFrameworkStep = defineStep<
	typeof nativeStyleFrameworkSchema.Type
>({
	id: "nativeStyleFramework",
	group: "style",
	schema: nativeStyleFrameworkSchema,
	configKey: "nativeStyleFramework",

	shouldRun: (config) => !!config.mobile,

	async execute(config, interactive) {
		if (!interactive) {
			if (config.nativeStyleFramework) {
				const result = Schema.decodeUnknownEither(nativeStyleFrameworkSchema)(
					config.nativeStyleFramework,
				);

				if (Either.isRight(result)) return result.right;
			}

			return SKIP;
		}

		const nativeStyleFramework = await select({
			message: `Which styling framework do you want to use for ${config.mobile ? mobileFrameworks.label(config.mobile) : "mobile"}?`,
			options: nativeStyleFrameworkOptions.map((option) => ({
				label: option === "none" ? "None" : nativeStyleFrameworks.label(option),
				value: option,
			})),
		});

		if (isCancel(nativeStyleFramework)) cancel();
		if (nativeStyleFramework === "none") return SKIP;

		return nativeStyleFramework;
	},
});

export default nativeStyleFrameworkStep;
