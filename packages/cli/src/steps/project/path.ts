import { normalize } from "node:path";
import { isCancel, log, text } from "@clack/prompts";
import { formatSchemaError } from "@ryuujs/core";
import { Result, Schema } from "effect";
import { cancel } from "../../utils/cancel";
import { defineStep, SKIP } from "../types";

export const pathSchema = Schema.Trim.pipe(
	Schema.check(
		Schema.isMinLength(1, { message: "You need to provide a path." }),
		Schema.isPattern(/^(\.\/.*|\.)$/, {
			message: "You need to provide a relative path.",
		}),
		Schema.makeFilter(
			(value) => {
				const normalized = normalize(value);
				return normalized !== ".." && !normalized.startsWith("..");
			},
			{ message: "You need to provide a path inside the current directory." },
		),
	),
);

const pathStep = defineStep<string>({
	id: "path",
	group: "project",
	schema: pathSchema,
	configKey: "path",

	dependencies: ["name"],

	shouldRun: () => true,

	validate(value) {
		const result = Schema.decodeUnknownResult(pathSchema)(value);
		if (Result.isSuccess(result)) return;

		const issues = formatSchemaError(result.failure);
		log.error(issues[0]?.message ?? "You need to provide a valid path.");

		process.exit(1);
	},

	async execute(config, interactive) {
		const slug = config.slug ?? "my-app";

		if (!interactive) {
			const value = config.path ?? `./${slug}`;

			const result = Schema.decodeResult(pathSchema)(value);
			if (Result.isFailure(result)) return SKIP;

			return result.success;
		}

		const defaultValue = `./${slug}`;

		const path = await text({
			message: "Where do you want us to create your project?",
			defaultValue,
			placeholder: defaultValue,
			validate: (value) => {
				const result = Schema.decodeResult(pathSchema)(value || defaultValue);
				if (Result.isFailure(result)) {
					const issues = formatSchemaError(result.failure);
					return issues[0]?.message;
				}
			},
		});

		if (isCancel(path)) cancel();

		return path;
	},
});

export default pathStep;
