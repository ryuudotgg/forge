import { isCancel, text } from "@clack/prompts";
import { z } from "zod";
import { cancel } from "../../utils/cancel";
import { defineStep, SKIP } from "../types";

export const pathSchema = z
	.string({ error: "You need to provide a path." })
	.trim()
	.min(1, { error: "You need to provide a path." })
	.regex(/^(\.\/.*|\.)$/, { error: "You need to provide a relative path." });

const pathStep = defineStep<string>({
	id: "path",
	group: "project",
	schema: pathSchema,
	configKey: "path",

	dependencies: ["name"],

	shouldRun: () => true,

	async execute(config, interactive) {
		const slug = typeof config.slug === "string" ? config.slug : "my-app";

		if (!interactive) {
			const existing =
				typeof config.path === "string" ? config.path : undefined;
			const value = existing ?? `./${slug}`;

			const result = pathSchema.safeParse(value);
			if (!result.success) return SKIP;

			return result.data;
		}

		const path = await text({
			message: "Where do you want us to create your project?",
			defaultValue: `./${slug}`,
			placeholder: `./${slug}`,
			validate: (value) => {
				const result = pathSchema.safeParse(value);
				if (result.error) return result.error.issues[0]?.message;
			},
		});

		if (isCancel(path)) cancel();

		return path;
	},
});

export default pathStep;
