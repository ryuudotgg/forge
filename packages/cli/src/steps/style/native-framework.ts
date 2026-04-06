import { isCancel, select } from "@clack/prompts";
import { Either, Schema } from "effect";
import { cancel } from "../../utils/cancel";
import { defineStep, SKIP } from "../types";

const nativeStyleFrameworkOptions = [
	"NativeWind",
	"Tamagui",
	"Unistyles",
	"None",
] as const;

type ValidNativeStyleFramework = Exclude<
	(typeof nativeStyleFrameworkOptions)[number],
	"None"
>;
const validNativeStyleFrameworks = nativeStyleFrameworkOptions.filter(
	(x): x is ValidNativeStyleFramework => x !== "None",
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
			message: `Which styling framework do you want to use for ${config.mobile}?`,
			options: nativeStyleFrameworkOptions.map((option) => ({
				label: option,
				value: option,
			})),
		});

		if (isCancel(nativeStyleFramework)) cancel();
		if (nativeStyleFramework === "None") return SKIP;

		return nativeStyleFramework;
	},
});

export default nativeStyleFrameworkStep;
