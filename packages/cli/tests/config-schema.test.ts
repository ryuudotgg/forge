import { Either, Schema } from "effect";
import { ArrayFormatter } from "effect/ParseResult";
import { describe, expect, it } from "vitest";
import { assembleSchema } from "../src/config/schema";
import { steps } from "../src/steps";
import { defineStep } from "../src/steps/types";

const configSchema = assembleSchema(steps);

function decodeConfig(input: unknown) {
	return Schema.decodeUnknownEither(configSchema)(input);
}

function decodeMessages(result: ReturnType<typeof decodeConfig>) {
	return Either.isLeft(result)
		? ArrayFormatter.formatErrorSync(result.left).map((issue) => issue.message)
		: [];
}

describe("assembleSchema", () => {
	it("decodes a complete create config", () => {
		const result = decodeConfig({
			name: "Acme",
			slug: "acme",
			path: "./acme",
			platforms: ["web"],
			web: "nextjs",
		});

		expect(Either.getOrThrow(result)).toEqual({
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

		expect(Either.isRight(result)).toBe(true);
	});

	it("rejects unavailable web frameworks with a friendly sentence", () => {
		const result = decodeConfig({
			name: "Acme",
			slug: "acme",
			path: "./acme",
			platforms: ["web"],
			web: "react-router",
		});

		expect(decodeMessages(result)).toContain(
			"We don't support React Router yet.",
		);
	});

	it("rejects unavailable backends with a friendly sentence", () => {
		const result = decodeConfig({
			name: "Acme",
			slug: "acme",
			path: "./acme",
			platforms: ["web"],
			web: "nextjs",
			backend: "hono",
		});

		expect(decodeMessages(result)).toContain("We don't support Hono yet.");
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

	it("rejects the desktop platform while it isn't available", () => {
		const result = decodeConfig({
			name: "Acme",
			slug: "acme",
			platforms: ["desktop"],
		});

		expect(decodeMessages(result)).toContain("We don't support Desktop yet.");
	});

	it("rejects the mobile platform while it isn't available", () => {
		const result = decodeConfig({
			name: "Acme",
			slug: "acme",
			platforms: ["mobile"],
		});

		expect(decodeMessages(result)).toContain("We don't support Mobile yet.");
	});

	it("lists every unsupported platform in one sentence", () => {
		const result = decodeConfig({
			name: "Acme",
			slug: "acme",
			platforms: ["web", "desktop", "mobile"],
			web: "nextjs",
		});

		expect(decodeMessages(result)).toContain(
			"We don't support Desktop and Mobile yet.",
		);
	});

	it("spreads schema shape fields from null-key steps into the struct", () => {
		const result = decodeConfig({ name: "Acme", slug: "acme" });

		expect(Either.getOrThrow(result)).toEqual({ name: "Acme", slug: "acme" });
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
		const result = Schema.decodeUnknownEither(schema)({});

		expect(Either.getOrThrow(result)).toEqual({ flavor: "vanilla" });
	});
});
