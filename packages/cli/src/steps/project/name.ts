import { isCancel, text } from "@clack/prompts";
import { Either, Schema } from "effect";
import { cancel } from "../../utils/cancel";
import { slugify } from "../../utils/slugify";
import { defineStep, SKIP } from "../types";

export const nameSchema = Schema.String.pipe(
	Schema.trimmed(),
	Schema.minLength(1, { message: () => "You need to provide a name." }),
	Schema.maxLength(15, {
		message: () => "It must be less than 15 characters.",
	}),
);

export const slugSchema = Schema.String.pipe(
	Schema.trimmed(),
	Schema.minLength(1, { message: () => "We couldn't generate a slug." }),
	Schema.maxLength(15, {
		message: () => "Your slug must be less than 15 characters.",
	}),
	Schema.pattern(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
		message: () =>
			"We couldn't generate a valid slug. Try again with a different name.",
	}),
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
		if (!interactive) {
			if (config.name && config.slug) {
				const nameResult = Schema.decodeUnknownEither(nameSchema)(config.name);
				if (Either.isLeft(nameResult)) return SKIP;

				const slugResult = Schema.decodeUnknownEither(slugSchema)(config.slug);
				if (Either.isLeft(slugResult)) return SKIP;

				return { name: nameResult.right, slug: slugResult.right };
			}

			if (config.name) {
				const nameResult = Schema.decodeUnknownEither(nameSchema)(config.name);
				if (Either.isLeft(nameResult)) return SKIP;

				const slug = slugify(nameResult.right);
				const slugResult = Schema.decodeUnknownEither(slugSchema)(slug);
				if (Either.isLeft(slugResult)) return SKIP;

				return { name: nameResult.right, slug: slugResult.right };
			}

			return SKIP;
		}

		const name = await text({
			message: "What is the name of your project?",
			placeholder: "eg. Acme",
			validate: (value) => {
				const nameResult = Schema.decodeUnknownEither(nameSchema)(value);
				if (Either.isLeft(nameResult)) return nameResult.left.message;

				const slugResult = Schema.decodeUnknownEither(slugSchema)(
					slugify(nameResult.right),
				);
				if (Either.isLeft(slugResult)) return slugResult.left.message;
			},
		});

		if (isCancel(name)) cancel();

		return { name, slug: slugify(name) };
	},
});

export default nameStep;
