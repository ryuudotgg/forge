import { z } from "zod";
import type { Step } from "../steps/types";

export function assembleSchema(steps: Step[]) {
	const shape: Record<string, z.ZodType> = {};

	for (const step of steps) {
		if (step.configKey === null && step.schemaShape) {
			for (const [key, schema] of Object.entries(step.schemaShape))
				shape[key] = schema;
		} else if (step.schema) {
			const key = step.configKey ?? step.id;

			if (key === "tailwindEcosystem") shape[key] = step.schema.default(false);
			else shape[key] = step.schema.optional();
		}
	}

	return z
		.object(shape)
		.superRefine((data, ctx) => {
			const platforms = Array.isArray(data.platforms)
				? data.platforms
				: undefined;

			if (platforms?.includes("Web") && !data.web)
				ctx.addIssue({
					code: z.ZodIssueCode.custom,
					message: "A web framework wasn't selected.",
				});

			if (platforms?.includes("Desktop") && !data.desktop)
				ctx.addIssue({
					code: z.ZodIssueCode.custom,
					message: "A desktop framework wasn't selected.",
				});

			if (platforms?.includes("Mobile") && !data.mobile)
				ctx.addIssue({
					code: z.ZodIssueCode.custom,
					message: "A mobile framework wasn't selected.",
				});
		})
		.transform((data) => {
			const {
				mobile,
				tailwindEcosystem,
				styleFramework,
				nativeStyleFramework,
			} = data;

			if (tailwindEcosystem === false)
				if (
					(mobile &&
						(!styleFramework || styleFramework === "Tailwind CSS") &&
						nativeStyleFramework === "NativeWind") ||
					(!mobile && styleFramework === "Tailwind CSS")
				)
					return { ...data, tailwindEcosystem: true };

			return data;
		});
}

export type Config = z.infer<ReturnType<typeof assembleSchema>>;
