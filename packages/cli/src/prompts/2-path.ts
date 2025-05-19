import { isCancel, text } from "@clack/prompts";
import { getUnsafeConfig, setConfig } from "../config";
import { pathSchema } from "../config/primitives/path";
import { cancel } from "../utils/cancel";

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
