import { isCancel, text } from "@clack/prompts";
import { setConfig } from "../config";
import { nameSchema } from "../config/primitives/name";
import { cancel } from "../utils/cancel";
import { slugify } from "../utils/slugify";

async function getName(): Promise<void> {
	const name = await text({
		message: "What is the name of your project?",
		placeholder: "eg. Acme",
		validate: (value) => {
			const result = nameSchema.safeParse(value);
			if (result.error) return result.error.issues[0]?.message;
		},
	});

	if (isCancel(name)) cancel();

	setConfig({ name, slug: slugify(name) });
}

export default getName;
