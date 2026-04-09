import { Schema } from "effect";
import type { Step } from "../steps/types";

type ContextFreeField =
	| Schema.Schema.AnyNoContext
	| Schema.PropertySignature<
			Schema.PropertySignature.Token,
			Schema.Schema.Type<Schema.Schema.AnyNoContext>,
			PropertyKey,
			Schema.PropertySignature.Token,
			Schema.Schema.Encoded<Schema.Schema.AnyNoContext>,
			boolean,
			never
	  >;

export function assembleSchema(steps: Step[]) {
	const fields: Record<string, ContextFreeField> = {};

	for (const step of steps) {
		if (step.configKey === null && step.schemaShape) {
			for (const [key, schema] of Object.entries(step.schemaShape))
				fields[key] = schema;
		} else if (step.schema) {
			const key = step.configKey ?? step.id;

			if (step.schemaDefault)
				fields[key] = Schema.optionalWith(step.schema, {
					default: step.schemaDefault,
				});
			else fields[key] = Schema.optional(step.schema);
		}
	}

	return Schema.Struct(fields).pipe(
		// biome-ignore lint/suspicious/useIterableCallbackReturn: this is not Array.filter
		Schema.filter((data) => {
			const platforms = Array.isArray(data.platforms)
				? data.platforms
				: undefined;

			if (platforms?.includes("web") && !data.web)
				return "A web framework wasn't selected.";

			if (platforms?.includes("desktop") && !data.desktop)
				return "A desktop framework wasn't selected.";

			if (platforms?.includes("mobile") && !data.mobile)
				return "A mobile framework wasn't selected.";
		}),
	);
}

export type Config = ReturnType<typeof assembleSchema>["Type"];
