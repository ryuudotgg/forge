import { isCancel, log, select } from "@clack/prompts";
import { checkPackageManager, packageManagers } from "@ryuujs/core";
import { Result, Schema } from "effect";
import { runCliEffectValue } from "../../runtime";
import { cancel } from "../../utils/cancel";
import { defineStep, type PartialConfig } from "../types";

const packageManagerOptions = Object.values(packageManagers).map(
	(p) => p.displayName,
);

export const packageManagerSchema = Schema.Literals(packageManagerOptions);

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

	async validate(value) {
		const result = Schema.decodeUnknownResult(packageManagerSchema)(value);
		if (Result.isFailure(result)) return;

		const check = await runCliEffectValue(checkPackageManager(result.success));
		if (!check.ok) {
			log.error(check.message);
			process.exit(1);
		}
	},

	async execute(config, interactive) {
		const smartDefault = getSmartDefault(config.runtime);

		if (!interactive) {
			const check = await runCliEffectValue(checkPackageManager(smartDefault));
			if (!check.ok) {
				log.error(check.message);
				process.exit(1);
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

		const check = await runCliEffectValue(checkPackageManager(packageManager));
		if (!check.ok) {
			log.error(check.message);
			process.exit(1);
		}

		return packageManager;
	},
});

export default packageManagerStep;
