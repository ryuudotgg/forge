import { isCancel, select } from "@clack/prompts";
import { z } from "zod";
import { cancel } from "../../utils/cancel";
import { defineStep } from "../types";

const packageManagerOptions = ["pnpm", "bun", "yarn", "npm"] as const;
export const packageManagerSchema = z.enum(packageManagerOptions);

function getSmartDefault(
	runtime: string | undefined,
): z.infer<typeof packageManagerSchema> {
	switch (runtime) {
		case "Bun":
			return "bun";

		case "Deno":
			return "pnpm";

		default:
			return "pnpm";
	}
}

const packageManagerStep = defineStep<z.infer<typeof packageManagerSchema>>({
	id: "packageManager",
	group: "project",
	schema: packageManagerSchema,
	configKey: "packageManager",

	dependencies: ["runtime"],

	shouldRun: () => true,

	async execute(config, interactive) {
		const runtime =
			typeof config.runtime === "string" ? config.runtime : undefined;
		const smartDefault = getSmartDefault(runtime);

		if (!interactive) {
			const existing =
				typeof config.packageManager === "string"
					? config.packageManager
					: undefined;

			if (existing) {
				const result = packageManagerSchema.safeParse(existing);
				if (result.success) return result.data;
			}

			return smartDefault;
		}

		const packageManager = await select({
			message: "What package manager do you want to use?",
			options: packageManagerOptions.map((option) => ({
				label: option === smartDefault ? `${option} (Recommended)` : option,
				value: option,
			})),
		});

		if (isCancel(packageManager)) cancel();

		return packageManager;
	},
});

export default packageManagerStep;
