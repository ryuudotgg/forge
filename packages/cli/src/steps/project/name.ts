import { isCancel, text } from "@clack/prompts";
import { formatSchemaError } from "@ryuujs/core";
import { Result, Schema } from "effect";
import { cancel } from "../../utils/cancel";
import { slugify } from "../../utils/slugify";
import { defineStep, SKIP } from "../types";

export const nameSchema = Schema.Trim.pipe(
	Schema.check(
		Schema.isMinLength(1, { message: "You need to provide a name." }),
		Schema.isMaxLength(15, {
			message: "It must be less than 15 characters.",
		}),
	),
);

export const slugSchema = Schema.Trim.pipe(
	Schema.check(
		Schema.isMinLength(1, { message: "We couldn't generate a slug." }),
		Schema.isMaxLength(15, {
			message: "Your slug must be less than 15 characters.",
		}),
		Schema.isPattern(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
			message:
				"We couldn't generate a valid slug. Try again with a different name.",
		}),
	),
);

const nameStep = defineStep<{ name: string; slug: string }>({
	id: "name",
	group: "project",
	schema: null,
	configKey: null,
	schemaShape: {
		name: nameSchema,
		slug: slugSchema,
	},

	shouldRun: () => true,

	async execute(config, interactive) {
		if (config.name && config.slug) {
			const nameResult = Schema.decodeUnknownResult(nameSchema)(config.name);
			const slugResult = Schema.decodeUnknownResult(slugSchema)(config.slug);
			if (Result.isSuccess(nameResult) && Result.isSuccess(slugResult))
				return { name: nameResult.success, slug: slugResult.success };
		}

		if (config.name) {
			const nameResult = Schema.decodeUnknownResult(nameSchema)(config.name);
			if (Result.isSuccess(nameResult)) {
				const slug = slugify(nameResult.success);
				const slugResult = Schema.decodeUnknownResult(slugSchema)(slug);
				if (Result.isSuccess(slugResult))
					return { name: nameResult.success, slug: slugResult.success };
			}
		}

		if (!interactive) return SKIP;

		const name = await text({
			message: "What is the name of your project?",
			placeholder: "eg. Acme",
			validate: (value) => {
				const nameResult = Schema.decodeUnknownResult(nameSchema)(value);
				if (Result.isFailure(nameResult)) {
					const issues = formatSchemaError(nameResult.failure);
					return issues[0]?.message;
				}

				const slugResult = Schema.decodeUnknownResult(slugSchema)(
					slugify(nameResult.success),
				);

				if (Result.isFailure(slugResult)) {
					const issues = formatSchemaError(slugResult.failure);
					return issues[0]?.message;
				}
			},
		});

		if (isCancel(name)) cancel();

		const trimmed = name.trim();
		return { name: trimmed, slug: slugify(trimmed) };
	},
});

export default nameStep;
