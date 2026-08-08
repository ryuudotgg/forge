import { readFileSync } from "node:fs";
import { log } from "@clack/prompts";
import { formatSchemaError } from "@ryuujs/core";
import { Result, Schema } from "effect";
import { buildFlagOverrides } from "../cli";
import { orchestrate } from "../orchestrator";
import { presets } from "../presets";
import { steps } from "../steps";
import type { PartialConfig } from "../steps/types";
import { listOr } from "../utils/list";

export async function runCreate(
	values: Record<string, string | boolean | undefined>,
) {
	let initialConfig: PartialConfig = {};

	if (values.preset) {
		const presetName = values.preset;

		if (typeof presetName !== "string" || !(presetName in presets)) {
			log.error(
				`We couldn't find this preset. You can use: ${listOr.format(Object.keys(presets))}.`,
			);

			process.exit(1);
		}

		initialConfig = { ...presets[presetName] };
	}

	if (values.config && typeof values.config === "string") {
		let parsed: unknown;

		try {
			parsed = JSON.parse(readFileSync(values.config, "utf-8"));
		} catch {
			log.error(
				`We couldn't read or parse the config file at "${values.config}".`,
			);

			process.exit(1);
		}

		const configSchema = Schema.Record(Schema.String, Schema.Unknown);

		const configResult = Schema.decodeUnknownResult(configSchema)(parsed);

		if (Result.isFailure(configResult)) {
			const issues = formatSchemaError(configResult.failure, parsed);
			const message = issues
				.map((i) =>
					i.path.length > 0
						? `  ${i.path.join(".")}: ${i.message}`
						: `  ${i.message}`,
				)
				.join("\n");

			log.error(`Your config file is invalid.\n${message}`);
			process.exit(1);
		}

		initialConfig = { ...initialConfig, ...configResult.success };
	}

	initialConfig = { ...initialConfig, ...buildFlagOverrides(values) };
	if (values["no-install"] === true) initialConfig.installDeps = false;
	if (values["no-git"] === true) initialConfig.gitInit = false;

	const interactive = !values.config;
	await orchestrate(steps, { initialConfig, interactive });
}
