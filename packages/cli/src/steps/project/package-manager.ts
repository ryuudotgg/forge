import { isCancel, select } from "@clack/prompts";
import { Either, Schema } from "effect";
import { cancel } from "../../utils/cancel";
import { defineStep, type PartialConfig } from "../types";

const packageManagerOptions = ["pnpm", "bun", "yarn", "npm"] as const;
export const packageManagerSchema = Schema.Literal(...packageManagerOptions);

function getSmartDefault(
	runtime: PartialConfig["runtime"],
): typeof packageManagerSchema.Type {
	switch (runtime) {
		case "Bun":
			return "bun";

		case "Deno":
			return "pnpm";

		default:
			return "pnpm";
	}
}

const packageManagerStep = defineStep<typeof packageManagerSchema.Type>({
	id: "packageManager",
	group: "project",
	schema: packageManagerSchema,
	configKey: "packageManager",

	dependencies: ["runtime"],

	shouldRun: () => true,

	async execute(config, interactive) {
		const smartDefault = getSmartDefault(config.runtime);

		if (!interactive) {
			if (config.packageManager) {
				const result = Schema.decodeUnknownEither(packageManagerSchema)(
					config.packageManager,
				);

				if (Either.isRight(result)) return result.right;
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
