import { isCancel, text } from "@clack/prompts";
import { z } from "zod";
import { cancel } from "../../utils/cancel";
import { slugify } from "../../utils/slugify";
import { defineStep, SKIP } from "../types";

export const nameSchema = z
	.string({ error: "You need to provide a name." })
	.trim()
	.min(1, { error: "You need to provide a name." })
	.max(15, { error: "It must be less than 15 characters." });

export const slugSchema = z
	.string({ error: "We couldn't generate a slug." })
	.trim()
	.min(1, { error: "We couldn't generate a slug." })
	.max(15, { error: "Your slug must be less than 15 characters." })
	.regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
		error:
			"We couldn't generate a valid slug. Try again with a different name.",
	});

const nameStep = defineStep<{ name: string; slug: string }>({
	id: "name",
	group: "project",
	schema: null,
	configKey: null,
	schemaShape: {
		name: nameSchema,
		slug: slugSchema,
	},

	shouldRun: () => true,

	async execute(config, interactive) {
		if (!interactive) {
			const existingName =
				typeof config.name === "string" ? config.name : undefined;
			const existingSlug =
				typeof config.slug === "string" ? config.slug : undefined;

			if (existingName && existingSlug) {
				const nameResult = nameSchema.safeParse(existingName);
				if (!nameResult.success) return SKIP;

				const slugResult = slugSchema.safeParse(existingSlug);
				if (!slugResult.success) return SKIP;

				return { name: nameResult.data, slug: slugResult.data };
			}

			if (existingName) {
				const nameResult = nameSchema.safeParse(existingName);
				if (!nameResult.success) return SKIP;

				const slug = slugify(nameResult.data);
				const slugResult = slugSchema.safeParse(slug);
				if (!slugResult.success) return SKIP;

				return { name: nameResult.data, slug: slugResult.data };
			}

			return SKIP;
		}

		const name = await text({
			message: "What is the name of your project?",
			placeholder: "eg. Acme",
			validate: (value) => {
				const nameResult = nameSchema.safeParse(value);
				if (nameResult.error) return nameResult.error.issues[0]?.message;

				const slugResult = slugSchema.safeParse(slugify(nameResult.data));
				if (slugResult.error) return slugResult.error.issues[0]?.message;
			},
		});

		if (isCancel(name)) cancel();

		return { name, slug: slugify(name) };
	},
});

export default nameStep;
