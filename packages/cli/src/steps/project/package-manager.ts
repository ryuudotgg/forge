import { tmpdir } from "node:os";
import { isCancel, log, select } from "@clack/prompts";
import {
	buildPackageManagerCheck,
	checkPackageManager,
	checkPackageManagerInstalled,
	packageManagers,
} from "@ryuugg/core";
import { Result, Schema } from "effect";
import type { PinnedPackageManager } from "../../commands/adoption";
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

async function requirePackageManager(
	packageManager: typeof packageManagerSchema.Type,
	pin: PinnedPackageManager | undefined,
) {
	const checks =
		pin?.packageManager === packageManager
			? [
					buildPackageManagerCheck(packageManager, pin.version),
					// Probing inside a pinned pnpm project makes pnpm write pnpm-lock.yaml.
					await runCliEffectValue(
						checkPackageManagerInstalled(packageManager, tmpdir()),
					),
				]
			: [await runCliEffectValue(checkPackageManager(packageManager))];

	const failed = checks.find((check) => !check.ok);
	if (failed !== undefined) {
		log.error(failed.message);
		process.exit(1);
	}
}

export function createPackageManagerStep(pin?: PinnedPackageManager) {
	return defineStep<typeof packageManagerSchema.Type>({
		id: "packageManager",
		group: "project",
		schema: packageManagerSchema,
		configKey: "packageManager",

		dependencies: ["runtime"],

		shouldRun: () => true,

		async validate(value) {
			const result = Schema.decodeUnknownResult(packageManagerSchema)(value);
			if (Result.isFailure(result)) return;
			await requirePackageManager(result.success, pin);
		},

		async execute(config, interactive) {
			if (pin !== undefined) {
				await requirePackageManager(pin.packageManager, pin);
				return pin.packageManager;
			}

			const smartDefault = getSmartDefault(config.runtime);
			if (!interactive) {
				await requirePackageManager(smartDefault, pin);
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

			await requirePackageManager(packageManager, pin);
			return packageManager;
		},
	});
}

const packageManagerStep = createPackageManagerStep();

export default packageManagerStep;
