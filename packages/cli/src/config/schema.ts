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
		// biome-ignore lint/suspicious/useIterableCallbackReturn: Schema.filter, not Array.filter
		Schema.filter((data) => {
			const platforms = Array.isArray(data.platforms)
				? data.platforms
				: undefined;

			if (platforms?.includes("Web") && !data.web)
				return "A web framework wasn't selected.";

			if (platforms?.includes("Desktop") && !data.desktop)
				return "A desktop framework wasn't selected.";

			if (platforms?.includes("Mobile") && !data.mobile)
				return "A mobile framework wasn't selected.";
		}),
	);
}

export function applyConfigDefaults<T extends Record<string, unknown>>(
	data: T,
): T {
	const { mobile, tailwindEcosystem, styleFramework, nativeStyleFramework } =
		data;

	if (tailwindEcosystem === false)
		if (
			(mobile &&
				(!styleFramework || styleFramework === "Tailwind CSS") &&
				nativeStyleFramework === "NativeWind") ||
			(!mobile && styleFramework === "Tailwind CSS")
		)
			return { ...data, tailwindEcosystem: true };

	return data;
}

export type Config = ReturnType<typeof assembleSchema>["Type"];
