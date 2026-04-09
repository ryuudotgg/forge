import { isCancel, select } from "@clack/prompts";
import { desktopFrameworks } from "@ryuujs/generators";
import { Either, Schema } from "effect";
import { cancel } from "../../utils/cancel";
import { defineStep } from "../types";

const desktopOptions = desktopFrameworks.ids;
export const desktopSchema = Schema.Literal(...desktopOptions);

const desktopStep = defineStep<typeof desktopSchema.Type>({
	id: "desktop",
	group: "platforms",
	schema: desktopSchema,
	configKey: "desktop",

	dependencies: ["platforms"],

	shouldRun: (config) => !!config.platforms?.includes("desktop"),

	async execute(config, interactive) {
		if (!interactive) {
			if (config.desktop) {
				const result = Schema.decodeUnknownEither(desktopSchema)(
					config.desktop,
				);

				if (Either.isRight(result)) return result.right;
			}

			return "electron";
		}

		const desktop = await select({
			message: "What is your preferred desktop framework?",
			options: desktopOptions.map((option, index) => ({
				label:
					index === 0
						? `${desktopFrameworks.label(option)} (Recommended)`
						: desktopFrameworks.label(option),
				value: option,
			})),
		});

		if (isCancel(desktop)) cancel();

		return desktop;
	},
});

export default desktopStep;
