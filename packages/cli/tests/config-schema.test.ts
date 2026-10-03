import { formatSchemaError } from "@ryuugg/core";
import { Result, Schema } from "effect";
import { describe, expect, it } from "vitest";
import { assembleSchema } from "../src/config/schema";
import { steps } from "../src/steps";
import { defineStep } from "../src/steps/types";

const configSchema = assembleSchema(steps);
function decodeConfig(input: unknown) {
	return Schema.decodeUnknownResult(configSchema)(input);
}

function decodeMessages(result: ReturnType<typeof decodeConfig>) {
	return Result.isFailure(result)
		? formatSchemaError(result.failure).map((issue) => issue.message)
		: [];
}

describe("assembleSchema", () => {
	it.each(["email-otp", "magic-link"])(
		"requires an email provider for %s",
		(method) => {
			const result = decodeConfig({
				name: "Acme",
				slug: "acme",
				authentication: "better-auth",
				authMethods: [method],
			});

			expect(decodeMessages(result)).toEqual([
				"Email OTP and magic link need an email provider.",
			]);
		},
	);

	it.each(["resend", "postmark", "smtp"])(
		"accepts email methods with %s",
		(emailProvider) => {
			for (const authMethods of [
				["email-otp"],
				["magic-link"],
				["email-otp", "magic-link"],
			]) {
				const result = decodeConfig({
					name: "Acme",
					slug: "acme",
					authentication: "better-auth",
					authMethods,
					emailProvider,
				});

				expect(decodeMessages(result)).toEqual([]);
				expect(Result.getOrThrow(result)).toMatchObject({
					authMethods,
					emailProvider,
				});
			}
		},
	);

	it("rejects duplicate secondary web app names", () => {
		const result = decodeConfig({
			name: "Acme",
			slug: "acme",
			web: "nextjs",
			webApps: [
				{ name: "admin", framework: "nextjs" },
				{ name: "admin", framework: "nextjs" },
			],
		});

		expect(decodeMessages(result)).toContain(
			"admin is used by more than one web app.",
		);
	});

	it("rejects reserved secondary web app names", () => {
		const result = decodeConfig({
			name: "Acme",
			slug: "acme",
			web: "nextjs",
			webApps: [{ name: "web", framework: "nextjs" }],
		});

		expect(decodeMessages(result)).toContain(
			"web is reserved. Pick another name for this web app.",
		);
	});

	it("accepts a secondary framework different from the primary", () => {
		const result = decodeConfig({
			name: "Acme",
			slug: "acme",
			web: "nextjs",
			webApps: [{ name: "admin", framework: "react-router" }],
		});

		expect(Result.isSuccess(result)).toBe(true);
	});

	it("requires a primary framework for secondary web apps", () => {
		const result = decodeConfig({
			name: "Acme",
			slug: "acme",
			webApps: [{ name: "admin", framework: "nextjs" }],
		});

		expect(decodeMessages(result)).toContain(
			"Secondary web apps need a web framework.",
		);
	});

	it("accepts secondary apps using the primary framework", () => {
		const result = decodeConfig({
			name: "Acme",
			slug: "acme",
			web: "tanstack-router",
			webApps: [{ name: "admin", framework: "tanstack-router" }],
		});

		expect(Result.isSuccess(result)).toBe(true);
	});

	it("accepts an empty secondary list without a primary framework", () => {
		expect(
			Result.isSuccess(
				decodeConfig({ name: "Acme", slug: "acme", webApps: [] }),
			),
		).toBe(true);
	});

	it.each(["admin", "polar"])("rejects %s without Better Auth", (plugin) => {
		const result = decodeConfig({
			name: "Acme",
			slug: "acme",
			authPlugins: [plugin],
		});

		expect(decodeMessages(result)).toContain(
			"Authentication plugins need Better Auth.",
		);
	});

	it("rejects username without the email-password method", () => {
		const result = decodeConfig({
			name: "Acme",
			slug: "acme",
			authentication: "better-auth",
			authMethods: ["google", "apple"],
			authPlugins: ["username"],
		});

		expect(decodeMessages(result)).toContain(
			"Username needs this sign-in method: Email and password.",
		);
	});

	it.each([
		{ authPlugins: ["username"], authMethods: ["email-password"] },
		{ authPlugins: ["admin"], authMethods: ["google", "apple"] },
		{ authPlugins: ["polar"], authMethods: ["google"] },
		{ authPlugins: ["polar"] },
		{ authPlugins: [], authMethods: ["google"] },
	])("accepts compatible auth plugins %j", (config) => {
		const result = decodeConfig({
			name: "Acme",
			slug: "acme",
			authentication: "better-auth",
			...config,
		});

		expect(Result.isSuccess(result)).toBe(true);
	});

	it.each([
		{ backend: "self", web: "nextjs", valid: false },
		{ backend: "hono", valid: true },
		{ mobile: "expo", valid: true },
	])(
		"checks username against resolved default methods %j",
		({ valid, ...config }) => {
			const result = decodeConfig({
				name: "Acme",
				slug: "acme",
				authentication: "better-auth",
				authPlugins: ["username"],
				...config,
			});

			expect(Result.isSuccess(result)).toBe(valid);
		},
	);

	it.each(
		[[], ["unknown"], ["google", "unknown"]].map((authMethods) => ({
			authMethods,
		})),
	)("rejects invalid auth methods $authMethods", ({ authMethods }) => {
		const result = decodeConfig({
			name: "Acme",
			slug: "acme",
			authentication: "better-auth",
			authMethods,
		});

		expect(Result.isFailure(result)).toBe(true);
	});

	it("rejects methods without Better Auth", () => {
		const result = decodeConfig({
			name: "Acme",
			slug: "acme",
			authMethods: ["google"],
		});

		expect(decodeMessages(result)).toContain(
			"Authentication methods need Better Auth.",
		);
	});

	it("accepts methods with Better Auth", () => {
		const result = decodeConfig({
			name: "Acme",
			slug: "acme",
			authentication: "better-auth",
			authMethods: ["email-password", "google", "apple"],
		});

		expect(Result.isSuccess(result)).toBe(true);
	});

	it("decodes a complete create config", () => {
		const result = decodeConfig({
			name: "Acme",
			slug: "acme",
			path: "./acme",
			platforms: ["web"],
			web: "nextjs",
		});

		expect(Result.getOrThrow(result)).toEqual({
			name: "Acme",
			slug: "acme",
			path: "./acme",
			platforms: ["web"],
			web: "nextjs",
		});
	});

	it("rejects unavailable authentication providers with a friendly sentence", () => {
		const result = decodeConfig({
			name: "Acme",
			slug: "acme",
			path: "./acme",
			platforms: ["web"],
			web: "nextjs",
			authentication: "authjs",
		});

		expect(decodeMessages(result)).toContain("We don't support Auth.js yet.");
	});

	it("accepts the available authentication provider", () => {
		const result = decodeConfig({
			name: "Acme",
			slug: "acme",
			path: "./acme",
			platforms: ["web"],
			web: "nextjs",
			authentication: "better-auth",
		});

		expect(Result.isSuccess(result)).toBe(true);
	});

	it("accepts React Router in a complete create config", () => {
		const result = decodeConfig({
			name: "Acme",
			slug: "acme",
			path: "./acme",
			platforms: ["web"],
			web: "react-router",
		});

		expect(Result.getOrThrow(result)).toMatchObject({
			platforms: ["web"],
			web: "react-router",
		});
	});

	it("accepts TanStack Router in a complete create config", () => {
		const result = decodeConfig({
			name: "Acme",
			slug: "acme",
			path: "./acme",
			platforms: ["web"],
			web: "tanstack-router",
		});

		expect(Result.getOrThrow(result)).toMatchObject({
			platforms: ["web"],
			web: "tanstack-router",
		});
	});

	it("accepts TanStack Start in a complete create config", () => {
		const result = decodeConfig({
			name: "Acme",
			slug: "acme",
			path: "./acme",
			platforms: ["web"],
			web: "tanstack-start",
		});

		expect(Result.getOrThrow(result)).toMatchObject({
			platforms: ["web"],
			web: "tanstack-start",
		});
	});

	it("rejects unavailable backends with a friendly sentence", () => {
		const result = decodeConfig({
			name: "Acme",
			slug: "acme",
			path: "./acme",
			platforms: ["web"],
			web: "nextjs",
			backend: "convex",
		});

		expect(decodeMessages(result)).toContain("We don't support Convex yet.");
	});

	it("rejects unavailable linters with a friendly sentence", () => {
		const result = decodeConfig({
			name: "Acme",
			slug: "acme",
			path: "./acme",
			platforms: ["web"],
			web: "nextjs",
			linter: "oxc",
		});

		expect(decodeMessages(result)).toContain("We don't support Oxc yet.");
	});

	it("rejects unavailable style frameworks with a friendly sentence", () => {
		const result = decodeConfig({
			name: "Acme",
			slug: "acme",
			path: "./acme",
			platforms: ["web"],
			web: "nextjs",
			style: "unocss",
		});

		expect(decodeMessages(result)).toContain("We don't support UnoCSS yet.");
	});

	it("requires a web framework when the web platform is selected", () => {
		const result = decodeConfig({
			name: "Acme",
			slug: "acme",
			platforms: ["web"],
		});

		expect(decodeMessages(result)).toEqual([
			"A web framework wasn't selected.",
		]);
	});

	it.each([
		["desktop", "A desktop framework wasn't selected."],
		["mobile", "A mobile framework wasn't selected."],
	] as const)(
		"requires a framework when the %s platform is selected",
		(platform, message) => {
			const platformStep = defineStep<ReadonlyArray<string>>({
				id: "platforms",
				group: "platforms",
				schema: Schema.Array(Schema.String),
				shouldRun: () => true,
				execute: async () => undefined,
			});

			const frameworkStep = defineStep<string>({
				id: platform,
				group: "platforms",
				schema: Schema.String,
				shouldRun: () => true,
				execute: async () => undefined,
			});

			const result = Schema.decodeResult(
				assembleSchema([platformStep, frameworkStep]),
			)({ platforms: [platform] });

			expect(decodeMessages(result)).toEqual([message]);
		},
	);

	it("rejects the desktop platform while it isn't available", () => {
		const result = decodeConfig({
			name: "Acme",
			slug: "acme",
			platforms: ["desktop"],
		});

		expect(decodeMessages(result)).toContain("We don't support Desktop yet.");
	});

	it("requires a mobile framework when mobile is selected", () => {
		const result = decodeConfig({
			name: "Acme",
			slug: "acme",
			platforms: ["mobile"],
		});

		expect(decodeMessages(result)).toContain(
			"A mobile framework wasn't selected.",
		);
	});

	it("rejects unavailable mobile frameworks", () => {
		const result = decodeConfig({
			name: "Acme",
			slug: "acme",
			platforms: ["mobile"],
			mobile: "react-native",
		});

		expect(decodeMessages(result)).toContain(
			"We don't support React Native yet.",
		);
	});

	it("accepts NativeWind with Expo", () => {
		const result = decodeConfig({
			name: "Acme",
			slug: "acme",
			platforms: ["mobile"],
			mobile: "expo",
			nativeStyleFramework: "nativewind",
		});

		expect(decodeMessages(result)).toEqual([]);
	});

	it("rejects unavailable native style frameworks", () => {
		const result = decodeConfig({
			name: "Acme",
			slug: "acme",
			platforms: ["mobile"],
			mobile: "expo",
			nativeStyleFramework: "tamagui",
		});

		expect(decodeMessages(result)).toContain("We don't support Tamagui yet.");
	});

	it("lists unsupported platforms in one sentence", () => {
		const result = decodeConfig({
			name: "Acme",
			slug: "acme",
			platforms: ["web", "desktop", "mobile"],
			web: "nextjs",
			mobile: "expo",
		});

		expect(decodeMessages(result)).toContain("We don't support Desktop yet.");
	});

	it("spreads schema shape fields from null-key steps into the struct", () => {
		const result = decodeConfig({ name: "Acme", slug: "acme" });
		expect(Result.getOrThrow(result)).toEqual({ name: "Acme", slug: "acme" });
	});

	it("validates schema shape fields with their own schemas", () => {
		const result = decodeConfig({ name: "Acme", slug: "Not A Slug" });

		expect(decodeMessages(result)).toEqual([
			"We couldn't generate a valid slug. Try again with a different name.",
		]);
	});

	it("applies schema defaults and keeps other fields optional", () => {
		const withDefault = defineStep<string>({
			id: "flavor",
			group: "project",
			schema: Schema.String,
			schemaDefault: () => "vanilla",
			shouldRun: () => true,
			execute: async () => undefined,
		});

		const withoutDefault = defineStep<string>({
			id: "topping",
			group: "project",
			schema: Schema.String,
			shouldRun: () => true,
			execute: async () => undefined,
		});

		const schema = assembleSchema([withDefault, withoutDefault]);
		const result = Schema.decodeResult(schema)({});

		expect(Result.getOrThrow(result)).toEqual({ flavor: "vanilla" });
	});
});
