import { Effect, Schema } from "effect";
import type { Step } from "../steps/types";

export function assembleSchema(steps: Step[]) {
	const fields: Record<
		string,
		Schema.Codec<unknown, unknown, never, never>
	> = {};

	for (const step of steps) {
		if (step.configKey === null && step.schemaShape) {
			for (const [key, schema] of Object.entries(step.schemaShape))
				fields[key] = schema;
		} else if (step.schema) {
			const key = step.configKey ?? step.id;

			if (step.schemaDefault)
				fields[key] = step.schema.pipe(
					Schema.optional,
					Schema.withDecodingDefaultType(Effect.sync(step.schemaDefault)),
				);
			else fields[key] = Schema.optional(step.schema);
		}
	}

	return Schema.Struct(fields).pipe(
		Schema.check(
			Schema.makeFilter((data) => {
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
		),
	);
}

export type Config = ReturnType<typeof assembleSchema>["Type"];
