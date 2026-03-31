import { isCancel, multiselect } from "@clack/prompts";
import { z } from "zod";
import { cancel } from "../../utils/cancel";
import { defineStep, SKIP } from "../types";

const platformOptions = ["Web", "Desktop", "Mobile"] as const;
export const platformsSchema = z.tuple(
	[z.enum(platformOptions)],
	z.enum(platformOptions),
);

type Platforms = z.infer<typeof platformsSchema>;

const platformsStep = defineStep<Platforms>({
	id: "platforms",
	group: "platforms",
	schema: platformsSchema,
	configKey: "platforms",

	shouldRun: () => true,

	async execute(config, interactive) {
		if (!interactive) {
			const existing = config.platforms;

			if (Array.isArray(existing)) {
				const result = platformsSchema.safeParse(existing);
				if (result.success) return result.data;
			}

			return SKIP;
		}

		const platforms = await multiselect({
			message: "What platforms do you want to support?",
			required: true,

			options: platformOptions.map((platform) => ({
				label: platform,
				value: platform,
			})),
		});

		if (isCancel(platforms)) cancel();

		const result = platformsSchema.safeParse(platforms);
		if (!result.success) return SKIP;

		return result.data;
	},
});

export default platformsStep;
