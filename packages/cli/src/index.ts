import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { z } from "zod";
import { buildFlagOverrides, getParseArgsOptions } from "./cli";
import { orchestrate } from "./orchestrator";
import { presets } from "./presets";
import { steps } from "./steps";
import type { PartialConfig } from "./steps/types";
import { printHelp } from "./utils/help";

const { values } = parseArgs({
	options: getParseArgsOptions(),
	strict: false,
});

if (values.help) {
	printHelp();
	process.exit(0);
}

if (values.version) {
	const { version } = await import("../package.json", {
		with: { type: "json" },
	});

	console.log(`Forge v${version}`);
	process.exit(0);
}

try {
	console.log();

	let initialConfig: PartialConfig = {};

	if (values.preset) {
		const presetName = values.preset;

		if (typeof presetName !== "string" || !(presetName in presets)) {
			console.error(
				`Unknown Preset: ${presetName}. Available: ${Object.keys(presets).join(", ")}`,
			);

			process.exit(1);
		}

		initialConfig = { ...presets[presetName] };
	}

	if (values.config && typeof values.config === "string") {
		const fileConfig = z
			.record(z.string(), z.unknown())
			.parse(JSON.parse(readFileSync(values.config, "utf-8")));

		initialConfig = { ...initialConfig, ...fileConfig };
	}

	initialConfig = { ...initialConfig, ...buildFlagOverrides(values) };

	const interactive = !values.config;
	await orchestrate(steps, { initialConfig, interactive });

	console.log();
} catch (error) {
	console.error(error);
}
