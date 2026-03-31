import { isCancel, select } from "@clack/prompts";
import { z } from "zod";
import { cancel } from "../../utils/cancel";
import { defineStep } from "../types";

const webOptions = [
	"Next.js",
	"React Router",
	"TanStack Router",
	"TanStack Start",
] as const;

export const webSchema = z.enum(webOptions);

const webStep = defineStep<z.infer<typeof webSchema>>({
	id: "web",
	group: "platforms",
	schema: webSchema,
	configKey: "web",

	dependencies: ["platforms"],

	shouldRun: (config) =>
		Array.isArray(config.platforms) && config.platforms.includes("Web"),

	async execute(config, interactive) {
		if (!interactive) {
			const existing = typeof config.web === "string" ? config.web : undefined;

			if (existing) {
				const result = webSchema.safeParse(existing);
				if (result.success) return result.data;
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
