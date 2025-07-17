import { isCancel, text } from "@clack/prompts";
import { z } from "zod";
import { getUnsafeConfig, setConfig } from "../config";
import { cancel } from "../utils/cancel";

export const pathSchema = z
	.string({ error: "You need to provide a path." })
	.trim()
	.min(1, { error: "You need to provide a path." })
	.regex(/^(\.\/.*|\.)$/, { error: "You need to provide a relative path." });

async function getPath(): Promise<void> {
	const { slug } = getUnsafeConfig();

	const path = await text({
		message: "Where do you want us to create your project?",
		placeholder: `./${slug}`,
		validate: (value) => {
			const result = pathSchema.safeParse(value);
			if (result.error) return result.error.issues[0]?.message;
		},
	});

	if (isCancel(path)) cancel();

	setConfig({ path });
}

export default getPath;
