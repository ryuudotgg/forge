import { isCancel, text } from "@clack/prompts";
import { z } from "zod";
import { setConfig } from "../config";
import { cancel } from "../utils/cancel";
import { slugify } from "../utils/slugify";

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

async function getName(): Promise<void> {
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

	setConfig({ name, slug: slugify(name) });
}

export default getName;
