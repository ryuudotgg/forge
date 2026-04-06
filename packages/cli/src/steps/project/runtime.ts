import { isCancel, select } from "@clack/prompts";
import { type Runtime, runtimes } from "@ryuujs/core";
import { Either, Schema } from "effect";
import { cancel } from "../../utils/cancel";
import { defineStep } from "../types";

const runtimeOptions = Object.values(runtimes).map(
	(r) => r.displayName,
) as Runtime[];

export const runtimeSchema = Schema.Literal(...runtimeOptions);

const runtimeStep = defineStep<typeof runtimeSchema.Type>({
	id: "runtime",
	group: "project",
	schema: runtimeSchema,
	configKey: "runtime",

	shouldRun: () => true,

	async execute(config, interactive) {
		if (!interactive) {
			if (config.runtime) {
				const result = Schema.decodeUnknownEither(runtimeSchema)(
					config.runtime,
				);

				if (Either.isRight(result)) return result.right;
			}

			return "Node.js";
		}

		const runtime = await select({
			message: "What JavaScript runtime do you want to use?",
			options: runtimeOptions.map((option, index) => ({
				label: index === 0 ? `${option} (Recommended)` : option,
				value: option,
			})),
		});

		if (isCancel(runtime)) cancel();

		return runtime;
	},
});

export default runtimeStep;
