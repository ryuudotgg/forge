import { readFileSync } from "node:fs";
import { log } from "@clack/prompts";
import { Either, Schema } from "effect";
import { ArrayFormatter } from "effect/ParseResult";
import { buildFlagOverrides } from "../cli";
import { orchestrate } from "../orchestrator";
import { presets } from "../presets";
import { steps } from "../steps";
import type { PartialConfig } from "../steps/types";
import { listOr } from "./shared";

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
		let raw: string;

		try {
			raw = readFileSync(values.config, "utf-8");
		} catch {
			log.error(`We couldn't read the config file at "${values.config}".`);
			process.exit(1);
		}

		const configSchema = Schema.Record({
			key: Schema.String,
			value: Schema.Unknown,
		});

		const configResult = Schema.decodeUnknownEither(configSchema)(
			JSON.parse(raw),
		);

		if (Either.isLeft(configResult)) {
			const issues = ArrayFormatter.formatErrorSync(configResult.left);
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

		initialConfig = { ...initialConfig, ...configResult.right };
	}

	initialConfig = { ...initialConfig, ...buildFlagOverrides(values) };

	const interactive = !values.config;
	await orchestrate(steps, { initialConfig, interactive });
}
