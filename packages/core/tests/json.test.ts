import { Cause, Effect, Exit, Option, Schema } from "effect";
import { describe, expect, it } from "vitest";
import { decodeJsonString } from "../src/index";

interface ParseFailure {
	readonly kind: "parse";
	readonly message: string;
}

interface ValidationFailure {
	readonly kind: "validation";
	readonly issues: ReadonlyArray<string>;
}

const handlers = {
	onParseError: (message: string): ParseFailure => ({
		kind: "parse",
		message,
	}),
	onValidationError: (issues: ReadonlyArray<string>): ValidationFailure => ({
		kind: "validation",
		issues,
	}),
};

const PortSchema = Schema.Struct({ port: Schema.Number });

async function decodeFailure(raw: string) {
	const exit = await Effect.runPromiseExit(
		decodeJsonString(raw, PortSchema, handlers),
	);

	if (!Exit.isFailure(exit)) throw new Error("Expected Decode Failure");

	const failure = Cause.failureOption(exit.cause);
	if (Option.isNone(failure)) throw new Error("Expected Decode Failure");

	return failure.value;
}

describe("json", () => {
	it("decodes a valid payload to the typed value", async () => {
		const result = await Effect.runPromise(
			decodeJsonString('{"port": 3000}', PortSchema, handlers),
		);

		expect(result).toEqual({ port: 3000 });
	});

	it("maps malformed json through the parse error handler", async () => {
		const failure = await decodeFailure("{not json");

		expect(failure.kind).toBe("parse");
		if (failure.kind !== "parse") throw new Error("Expected Parse Failure");

		expect(failure.message).toContain("Transformation process failure");
		expect(failure.message).toContain(
			"Expected property name or '}' in JSON at position 1",
		);
	});

	it("formats nested validation issues with dotted paths", async () => {
		const failure = await decodeFailure('{"port": "x"}');

		expect(failure).toEqual({
			kind: "validation",
			issues: ['port: Expected number, actual "x"'],
		});
	});

	it("formats top-level validation issues without a path prefix", async () => {
		const failure = await decodeFailure("[]");

		expect(failure).toEqual({
			kind: "validation",
			issues: ["Expected { readonly port: number }, actual []"],
		});
	});
});
