import { isCancel, log, select } from "@clack/prompts";
import { mobileFrameworks, nativeStyleFrameworks } from "@ryuujs/generators";
import { Result, Schema } from "effect";
import { cancel } from "../../utils/cancel";
import {
	availableChoice,
	choiceOptions,
	unsupportedMessage,
} from "../../utils/choices";
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

export const nativeStyleFrameworkSchema = Schema.Literals(
	validNativeStyleFrameworks,
).pipe(Schema.check(Schema.makeFilter(availableChoice(nativeStyleFrameworks))));

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
				const result = Schema.decodeResult(nativeStyleFrameworkSchema)(
					config.nativeStyleFramework,
				);

				if (Result.isSuccess(result)) return result.success;
			}

			return SKIP;
		}

		for (;;) {
			const nativeStyleFramework = await select({
				message: `Which styling framework do you want to use for ${config.mobile ? mobileFrameworks.label(config.mobile) : "mobile"}?`,
				options: [
					...choiceOptions(nativeStyleFrameworks),
					{ label: "None", value: "none" as const },
				],
			});

			if (isCancel(nativeStyleFramework)) cancel();
			if (nativeStyleFramework === "none") return SKIP;
			if (nativeStyleFrameworks.available(nativeStyleFramework))
				return nativeStyleFramework;

			log.warn(
				unsupportedMessage(nativeStyleFrameworks, [nativeStyleFramework]),
			);
		}
	},
});

export default nativeStyleFrameworkStep;
