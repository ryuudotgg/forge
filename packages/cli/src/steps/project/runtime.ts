import { isCancel, select } from "@clack/prompts";
import { z } from "zod";
import { cancel } from "../../utils/cancel";
import { defineStep } from "../types";

const runtimeOptions = ["Node.js", "Bun", "Deno"] as const;
export const runtimeSchema = z.enum(runtimeOptions);

const runtimeStep = defineStep<z.infer<typeof runtimeSchema>>({
	id: "runtime",
	group: "project",
	schema: runtimeSchema,
	configKey: "runtime",

	shouldRun: () => true,

	async execute(config, interactive) {
		if (!interactive) {
			const existing =
				typeof config.runtime === "string" ? config.runtime : undefined;

			if (existing) {
				const result = runtimeSchema.safeParse(existing);
				if (result.success) return result.data;
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
