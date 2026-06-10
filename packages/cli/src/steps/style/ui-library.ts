import { isCancel, select } from "@clack/prompts";
import { uiLibraries } from "@ryuujs/generators";
import { Either, Schema } from "effect";
import { cancel } from "../../utils/cancel";
import { defineStep, SKIP } from "../types";

export const uiLibrarySchema = Schema.Literal(...uiLibraries.ids);

const uiLibraryStep = defineStep<typeof uiLibrarySchema.Type>({
	id: "uiLibrary",
	group: "style",
	schema: uiLibrarySchema,
	configKey: "uiLibrary",

	dependencies: ["web"],

	shouldRun: (config) => !!config.web,

	async execute(config, interactive) {
		if (!interactive) {
			const normalized = uiLibraries.normalize(config.uiLibrary);
			if (normalized) {
				const result = Schema.decodeUnknownEither(uiLibrarySchema)(normalized);
				if (Either.isRight(result)) return result.right;
			}

			return SKIP;
		}

		const uiLibrary = await select({
			message: "Which primitive library should your UI components use?",
			options: uiLibraries.ids.map((option) => ({
				label: uiLibraries.label(option),
				value: option,
			})),
		});

		if (isCancel(uiLibrary)) cancel();

		return uiLibrary;
	},
});

export default uiLibraryStep;
