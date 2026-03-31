import { isCancel, select } from "@clack/prompts";
import { z } from "zod";
import { cancel } from "../../utils/cancel";
import { defineStep, SKIP } from "../types";

const nativeStyleFrameworkOptions = [
	"NativeWind",
	"Tamagui",
	"Unistyles",
	"None",
] as const;

export const nativeStyleFrameworkSchema = z.enum(
	nativeStyleFrameworkOptions.filter((framework) => framework !== "None"),
);

const nativeStyleFrameworkStep = defineStep<
	z.infer<typeof nativeStyleFrameworkSchema>
>({
	id: "nativeStyleFramework",
	group: "style",
	schema: nativeStyleFrameworkSchema,
	configKey: "nativeStyleFramework",

	dependencies: ["tailwindEcosystem"],

	shouldRun: (config) => !!config.mobile,

	async execute(config, interactive) {
		if (config.tailwindEcosystem === true) return "NativeWind";

		if (!interactive) {
			const existing =
				typeof config.nativeStyleFramework === "string"
					? config.nativeStyleFramework
					: undefined;

			if (existing) {
				const result = nativeStyleFrameworkSchema.safeParse(existing);
				if (result.success) return result.data;
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
