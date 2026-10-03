import { unmetAuthPluginRequirements } from "@ryuugg/generators";
import { Effect, Schema } from "effect";
import { authPluginRequirementMessage } from "../steps/auth/plugins";
import * as schemas from "../steps/schemas";
import type { Step } from "../steps/types";

const authPluginConfigSchema = Schema.Struct({
	authentication: Schema.optional(schemas.authentication),
	authMethods: Schema.optional(schemas.authMethods),
	authPlugins: Schema.optional(schemas.authPlugins),
	backend: Schema.optional(schemas.backend),
	web: Schema.optional(schemas.web),
	mobile: Schema.optional(schemas.mobile),
});

const webAppsConfigSchema = Schema.Struct({
	web: Schema.optional(schemas.web),
	webApps: schemas.webApps,
});

export function assembleSchema(steps: Step[]) {
	const fields: Record<
		string,
		Schema.Codec<unknown, unknown, never, never>
	> = {};

	for (const step of steps)
		if (step.configKey === null && step.schemaShape)
			for (const [key, schema] of Object.entries(step.schemaShape))
				fields[key] = schema;
		else if (step.schema) {
			const key = step.configKey ?? step.id;
			if (step.schemaDefault)
				fields[key] = step.schema.pipe(
					Schema.optional,
					Schema.withDecodingDefaultType(Effect.sync(step.schemaDefault)),
				);
			else fields[key] = Schema.optional(step.schema);
		}

	return Schema.Struct(fields).pipe(
		Schema.check(
			Schema.makeFilter((data) => {
				if (Schema.is(webAppsConfigSchema)(data))
					if (data.web === undefined && data.webApps.length !== 0)
						return "Secondary web apps need a web framework.";

				if (
					data.authMethods !== undefined &&
					data.authentication !== "better-auth"
				)
					return "Authentication methods need Better Auth.";

				if (
					data.authPlugins !== undefined &&
					data.authentication !== "better-auth"
				)
					return "Authentication plugins need Better Auth.";

				if (Schema.is(authPluginConfigSchema)(data)) {
					const missing = unmetAuthPluginRequirements(data);
					if (missing.length !== 0)
						return authPluginRequirementMessage(missing);
				}

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
