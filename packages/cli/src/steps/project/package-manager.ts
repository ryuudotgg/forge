import { isCancel, log, select } from "@clack/prompts";
import {
	checkPackageManager,
	type PackageManager,
	packageManagers,
} from "@ryuujs/core";
import { Either, Schema } from "effect";
import { cancel } from "../../utils/cancel";
import { defineStep, type PartialConfig } from "../types";

const packageManagerOptions = Object.values(packageManagers).map(
	(p) => p.displayName,
) as PackageManager[];

export const packageManagerSchema = Schema.Literal(...packageManagerOptions);

function getSmartDefault(
	runtime: PartialConfig["runtime"],
): typeof packageManagerSchema.Type {
	switch (runtime) {
		case "Bun":
			return "Bun";

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

				return Either.isRight(result) ? result.right : smartDefault;
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

		const check = checkPackageManager(packageManager);
		if (!check.ok) {
			log.error(check.message);
			process.exit(1);
		}

		return packageManager;
	},
});

export default packageManagerStep;
