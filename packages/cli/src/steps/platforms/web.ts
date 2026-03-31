import { isCancel, select } from "@clack/prompts";
import { Either, Schema } from "effect";
import { cancel } from "../../utils/cancel";
import { defineStep } from "../types";

const webOptions = [
	"Next.js",
	"React Router",
	"TanStack Router",
	"TanStack Start",
] as const;

export const webSchema = Schema.Literal(...webOptions);

const webStep = defineStep<typeof webSchema.Type>({
	id: "web",
	group: "platforms",
	schema: webSchema,
	configKey: "web",

	dependencies: ["platforms"],

	shouldRun: (config) => !!config.platforms?.includes("Web"),

	async execute(config, interactive) {
		if (!interactive) {
			if (config.web) {
				const result = Schema.decodeUnknownEither(webSchema)(config.web);
				if (Either.isRight(result)) return result.right;
			}

			return "Next.js";
		}

		const web = await select({
			message: "What is your preferred web framework?",
			options: webOptions.map((option, index) => ({
				label: index === 0 ? `${option} (Recommended)` : option,
				value: option,
			})),
		});

		if (isCancel(web)) cancel();

		return web;
	},
});

export default webStep;
