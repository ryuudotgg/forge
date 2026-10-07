import { readFileSync } from "node:fs";
import { log } from "@clack/prompts";
import { formatSchemaError } from "@ryuugg/core";
import { Result, Schema } from "effect";
import { buildFlagOverrides, decodeChoice, options } from "../cli";
import { acceptedConfigKeys, droppedValueIssue } from "../config/schema";
import { orchestrate } from "../orchestrator";
import { presets } from "../presets";
import { steps } from "../steps";
import {
	firstPartyAddonIds,
	webAppNameIssue,
	webAppsSchema,
} from "../steps/platforms/web-apps";
import type { PartialConfig } from "../steps/types";
import { editDistance } from "../utils/edit-distance";
import { listOr } from "../utils/list";

export async function runCreate(
	values: Record<string, string | boolean | string[] | undefined>,
) {
	const overrides = buildFlagOverrides(values);

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

		const acceptedKeys = acceptedConfigKeys(steps);
		const unknownKeys = Object.keys(configResult.success).filter(
			(key) => !acceptedKeys.includes(key),
		);

		for (const key of unknownKeys) {
			const alias = Object.entries(options).flatMap(([flag, option]) =>
				flag === key && "configKey" in option && option.configKey !== key
					? [option.configKey]
					: [],
			)[0];

			const suggestion =
				alias ??
				acceptedKeys.reduce((closest, candidate) =>
					editDistance(key.toLowerCase(), candidate.toLowerCase()) <
					editDistance(key.toLowerCase(), closest.toLowerCase())
						? candidate
						: closest,
				);

			log.error(
				`Your config file sets ${JSON.stringify(key)}, which isn't a setting. Did you mean ${JSON.stringify(suggestion)}?`,
			);
		}

		if (unknownKeys.length !== 0) process.exit(1);

		const config = { ...configResult.success };
		for (const option of Object.values(options)) {
			if (!("choices" in option)) continue;

			const key = option.configKey;
			if (config[key] !== undefined && overrides[key] === undefined)
				config[key] = decodeChoice(option.choices, config[key], {
					configKey: key,
				});
		}

		const configuredWebApps = Schema.decodeUnknownResult(
			Schema.Array(Schema.Record(Schema.String, Schema.Unknown)),
		)(config.webApps);

		if (Result.isSuccess(configuredWebApps) && overrides.webApps === undefined)
			config.webApps = configuredWebApps.success.map((app, index) =>
				app.framework === undefined
					? app
					: {
							...app,
							framework: decodeChoice(options.web.choices, app.framework, {
								configKey: `webApps[${index}].framework`,
							}),
						},
			);

		initialConfig = { ...initialConfig, ...config };
	}

	initialConfig = { ...initialConfig, ...overrides };

	const droppedIssue = droppedValueIssue(initialConfig);
	if (droppedIssue !== undefined) {
		log.error(droppedIssue);
		process.exit(1);
	}

	const configuredApps = Schema.decodeUnknownResult(webAppsSchema)(
		initialConfig.webApps ?? [],
	);

	if (Result.isSuccess(configuredApps)) {
		const addonIds = firstPartyAddonIds();
		const issue = configuredApps.success
			.map((app) => webAppNameIssue(app.name, addonIds))
			.find((entry) => entry !== undefined);

		if (issue !== undefined) {
			log.error(issue);
			process.exit(1);
		}
	}

	if (values["no-install"] === true) initialConfig.installDeps = false;
	if (values["no-git"] === true) initialConfig.gitInit = false;

	const interactive = !values.config;
	await orchestrate(steps, { initialConfig, interactive });
}
