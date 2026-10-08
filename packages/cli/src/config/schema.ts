import { formatSchemaError } from "@ryuugg/core";
import {
	authenticationProviders,
	authPasskeyIssue,
	authPluginRequirementMessage,
	databaseProviderIdsFor,
	databaseProviders,
	databases,
	orms,
	platforms,
	twoFactorSkippedMessage,
	twoFactorSkippingMethods,
	unmetAuthPluginRequirements,
	webAppNamesIssue,
	webAppPortIssue,
} from "@ryuugg/generators";
import { Effect, Result, Schema } from "effect";
import * as schemas from "../steps/schemas";
import type { Step } from "../steps/types";
import { unsupportedMessage } from "../utils/choices";
import { listOr } from "../utils/list";

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
	webName: Schema.optional(schemas.webName),
	webApps: Schema.optional(schemas.webApps),
});

const checkedConfigSchema = Schema.Struct({
	authentication: Schema.optional(schemas.authentication),
	authMethods: Schema.optional(schemas.authMethods),
	authPlugins: Schema.optional(schemas.authPlugins),
	backend: Schema.optional(schemas.backend),
	desktop: Schema.optional(schemas.desktop),
	emailProvider: Schema.optional(schemas.emailProvider),
	mobile: Schema.optional(schemas.mobile),
	platforms: Schema.optional(schemas.platforms),
	web: Schema.optional(schemas.web),
	webName: Schema.optional(schemas.webName),
	webApps: Schema.optional(schemas.webApps),
});

export function invalidConfigMessage(
	error: Schema.SchemaError,
	config: Record<string, unknown>,
) {
	const issues = formatSchemaError(error, config)
		.map((issue) =>
			issue.path.length > 0
				? `  ${issue.path.join(".")}: ${issue.message}`
				: `  ${issue.message}`,
		)
		.join("\n");

	return `Invalid Configuration:\n${issues}`;
}

const webAppConfigShape = Schema.Struct({
	web: Schema.optional(Schema.String),
	webName: Schema.optional(Schema.String),
	webApps: Schema.optional(
		Schema.Array(
			Schema.Struct({ name: Schema.String, framework: Schema.String }),
		),
	),
});

export function webAppConfigShapeIssue(
	config: Record<string, unknown>,
): string | undefined {
	return Schema.is(webAppConfigShape)(config)
		? undefined
		: malformedConfigIssue(config);
}

export function malformedConfigIssue(
	config: Record<string, unknown>,
): string | undefined {
	const result = Schema.decodeUnknownResult(checkedConfigSchema)(config);
	if (Result.isFailure(result))
		return invalidConfigMessage(result.failure, config);
}

export function droppedValueIssue(
	data: Record<string, unknown>,
): string | undefined {
	if (
		Schema.is(schemas.database)(data.database) &&
		Schema.is(schemas.databaseProvider)(data.databaseProvider)
	) {
		const providers = databaseProviderIdsFor(data.database);
		if (!providers.includes(data.databaseProvider))
			return `${databaseProviders.label(data.databaseProvider)} doesn't host ${databases.label(data.database)}, so pick ${listOr.format(providers.map((provider) => databaseProviders.label(provider)))}.`;
	}

	if (
		data.catalogs !== undefined &&
		data.packageManager !== undefined &&
		data.packageManager !== "pnpm"
	)
		return "pnpm Catalogs need pnpm.";

	if (data.desktop !== undefined) {
		if (!platforms.available("desktop"))
			return unsupportedMessage(platforms, ["desktop"]);

		if (Array.isArray(data.platforms) && !data.platforms.includes("desktop"))
			return "A desktop framework needs the Desktop platform.";
	}
}

export function configIssue(data: Record<string, unknown>): string | undefined {
	if (data.webName !== undefined && data.web === undefined)
		return "A web app name needs a web framework.";

	if (data.databaseProvider !== undefined && data.database === undefined)
		return "A database provider needs a database.";

	const droppedIssue = droppedValueIssue(data);
	if (droppedIssue !== undefined) return droppedIssue;

	if (Schema.is(webAppsConfigSchema)(data)) {
		if (data.web === undefined && (data.webApps?.length ?? 0) !== 0)
			return "Secondary web apps need a web framework.";

		const nameIssue = webAppNamesIssue(data);
		if (nameIssue !== undefined) return nameIssue;

		const portIssue = webAppPortIssue(data);
		if (portIssue !== undefined) return portIssue;
	}

	if (data.authMethods !== undefined && data.authentication !== "better-auth")
		return "Authentication methods need Better Auth.";

	if (data.authPlugins !== undefined && data.authentication !== "better-auth")
		return "Authentication plugins need Better Auth.";

	if (
		Array.isArray(data.authMethods) &&
		(data.authMethods.includes("email-otp") ||
			data.authMethods.includes("magic-link")) &&
		data.emailProvider === undefined
	)
		return "Email OTP and magic link need an email provider.";

	if (Schema.is(authPluginConfigSchema)(data)) {
		const missing = unmetAuthPluginRequirements(data);
		if (missing.length !== 0) return authPluginRequirementMessage(missing);

		const skipping = twoFactorSkippingMethods(data);
		if (skipping.length !== 0) return twoFactorSkippedMessage(skipping);
	}

	const platforms = Array.isArray(data.platforms) ? data.platforms : undefined;
	if (platforms?.includes("web") && !data.web)
		return "A web framework wasn't selected.";

	if (platforms?.includes("desktop") && !data.desktop)
		return "A desktop framework wasn't selected.";

	if (platforms?.includes("mobile") && !data.mobile)
		return "A mobile framework wasn't selected.";

	if (Schema.is(authPluginConfigSchema)(data)) {
		const passkeyIssue = authPasskeyIssue(data);
		if (passkeyIssue !== undefined) return passkeyIssue;
	}
}

export function ormIssue(config: Record<string, unknown>): string | undefined {
	if (
		authenticationProviders.normalize(config.authentication) ===
			"better-auth" &&
		!orms.normalize(config.orm)
	)
		return "You need to add an ORM before you can use Better Auth.";
}

function schemaFields(steps: Step[]) {
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

	return fields;
}

export function acceptedConfigKeys(steps: Step[]): string[] {
	return [
		...new Set([...Object.keys(schemaFields(steps)), "installDeps", "gitInit"]),
	];
}

export function assembleSchema(steps: Step[]) {
	return Schema.Struct(schemaFields(steps)).pipe(
		Schema.check(Schema.makeFilter(configIssue)),
	);
}

export type Config = ReturnType<typeof assembleSchema>["Type"];
