import { normalize } from "node:path";
import { isCancel, log, text } from "@clack/prompts";
import { Either, Schema } from "effect";
import { ArrayFormatter } from "effect/ParseResult";
import { cancel } from "../../utils/cancel";
import { defineStep, SKIP } from "../types";

export const pathSchema = Schema.Trim.pipe(
	Schema.minLength(1, { message: () => "You need to provide a path." }),
	Schema.pattern(/^(\.\/.*|\.)$/, {
		message: () => "You need to provide a relative path.",
	}),
	Schema.filter(
		(value) => {
			const normalized = normalize(value);
			return normalized !== ".." && !normalized.startsWith("..");
		},
		{
			message: () => "You need to provide a path inside the current directory.",
		},
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
		const result = Schema.decodeUnknownEither(pathSchema)(value);
		if (Either.isRight(result)) return;

		const issues = ArrayFormatter.formatErrorSync(result.left);
		log.error(issues[0]?.message ?? "You need to provide a valid path.");

		process.exit(1);
	},

	async execute(config, interactive) {
		const slug = config.slug ?? "my-app";

		if (!interactive) {
			const value = config.path ?? `./${slug}`;

			const result = Schema.decodeUnknownEither(pathSchema)(value);
			if (Either.isLeft(result)) return SKIP;

			return result.right;
		}

		const defaultValue = `./${slug}`;

		const path = await text({
			message: "Where do you want us to create your project?",
			defaultValue,
			placeholder: defaultValue,
			validate: (value) => {
				const result = Schema.decodeUnknownEither(pathSchema)(
					value || defaultValue,
				);

				if (Either.isLeft(result)) {
					const issues = ArrayFormatter.formatErrorSync(result.left);
					return issues[0]?.message;
				}
			},
		});

		if (isCancel(path)) cancel();

		return path;
	},
});

export default pathStep;
