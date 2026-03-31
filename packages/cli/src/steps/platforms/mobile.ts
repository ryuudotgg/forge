import { isCancel, select } from "@clack/prompts";
import { z } from "zod";
import { cancel } from "../../utils/cancel";
import { defineStep } from "../types";

const mobileOptions = ["Expo", "React Native"] as const;
export const mobileSchema = z.enum(mobileOptions);

const mobileStep = defineStep<z.infer<typeof mobileSchema>>({
	id: "mobile",
	group: "platforms",
	schema: mobileSchema,
	configKey: "mobile",

	dependencies: ["platforms"],

	shouldRun: (config) =>
		Array.isArray(config.platforms) && config.platforms.includes("Mobile"),

	async execute(config, interactive) {
		if (!interactive) {
			const existing =
				typeof config.mobile === "string" ? config.mobile : undefined;

			if (existing) {
				const result = mobileSchema.safeParse(existing);
				if (result.success) return result.data;
			}

			return "Expo";
		}

		const mobile = await select({
			message: "What is your preferred mobile framework?",
			options: mobileOptions.map((option, index) => ({
				label: index === 0 ? `${option} (Recommended)` : option,
				value: option,
			})),
		});

		if (isCancel(mobile)) cancel();

		return mobile;
	},
});

export default mobileStep;
