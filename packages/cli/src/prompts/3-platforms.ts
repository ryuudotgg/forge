import { isCancel, multiselect } from "@clack/prompts";
import { z } from "zod";
import { setConfig } from "../config";
import { cancel } from "../utils/cancel";

const platformOptions = ["Web", "Desktop", "Mobile"] as const;
export const platformsSchema = z.tuple(
	[z.enum(platformOptions)],
	z.enum(platformOptions),
);

async function getPlatforms(): Promise<void> {
	const platforms = await multiselect({
		message: "What platforms do you want to support?",
		required: true,

		options: platformOptions.map((platform) => ({
			label: platform,
			value: platform,
		})),
	});

	if (isCancel(platforms)) cancel();

	setConfig({ platforms: platforms as z.infer<typeof platformsSchema> });
}

export default getPlatforms;
