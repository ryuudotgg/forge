import {
	Cause,
	Effect,
	Exit,
	Option,
	Result,
	Schema,
	SchemaIssue,
} from "effect";
import { describe, expect, it } from "vitest";
import {
	decodeJsonString,
	formatSchemaIssues,
	LockfileSchema,
	ManifestSchema,
} from "../src/index";

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

const PortSchema = Schema.Struct({ port: Schema.String });

async function decodeFailure(raw: string) {
	const exit = await Effect.runPromiseExit(
		decodeJsonString(raw, PortSchema, handlers),
	);

	if (!Exit.isFailure(exit)) throw new Error("Expected Decode Failure");

	const failure = Cause.findErrorOption(exit.cause);
	if (Option.isNone(failure)) throw new Error("Expected Decode Failure");

	return failure.value;
}

function validationIssues(
	schema: Schema.Codec<unknown, unknown, never, never>,
	input: unknown,
) {
	const result = Schema.decodeUnknownResult(schema)(input);
	if (Result.isSuccess(result)) throw new Error("Expected Validation Failure");

	return formatSchemaIssues(result.failure, input);
}

describe("json", () => {
	it("decodes a valid payload to the typed value", async () => {
		const result = await Effect.runPromise(
			decodeJsonString('{"port": "3000"}', PortSchema, handlers),
		);

		expect(result).toEqual({ port: "3000" });
	});

	it("maps malformed json through the parse error handler", async () => {
		const failure = await decodeFailure("{not json");

		expect(failure.kind).toBe("parse");
		if (failure.kind !== "parse") throw new Error("Expected Parse Failure");

		expect(failure.message).toBe(
			"Expected property name or '}' in JSON at position 1 (line 1 column 2)",
		);
	});

	it("formats nested validation issues with dotted paths", async () => {
		const failure = await decodeFailure('{"port": 1}');

		expect(failure).toEqual({
			kind: "validation",
			issues: ["port: Expected string, actual 1"],
		});
	});

	it("formats top-level validation issues without a path prefix", async () => {
		const failure = await decodeFailure("[]");

		expect(failure).toEqual({
			kind: "validation",
			issues: ["Expected { readonly port: string }, actual []"],
		});
	});

	it("formats primitive and literal expectations", () => {
		expect(validationIssues(Schema.String, 1)).toEqual([
			"Expected string, actual 1",
		]);
		expect(validationIssues(Schema.Boolean, "yes")).toEqual([
			'Expected boolean, actual "yes"',
		]);
		expect(validationIssues(Schema.Literal("forge"), "other")).toEqual([
			'Expected "forge", actual "other"',
		]);
		expect(validationIssues(Schema.Literal(1), 2)).toEqual([
			"Expected 1, actual 2",
		]);
		expect(
			validationIssues(Schema.Struct({ value: Schema.Unknown }), []),
		).toEqual(["Expected { readonly value: unknown }, actual []"]);
	});

	it("formats array expectations with v3 wording", () => {
		expect(validationIssues(Schema.Array(Schema.String), {})).toEqual([
			"Expected ReadonlyArray<string>, actual {}",
		]);
		expect(
			validationIssues(
				Schema.Array(Schema.Union([Schema.String, Schema.Finite])),
				{},
			),
		).toEqual(["Expected ReadonlyArray<string | a finite number>, actual {}"]);
	});

	it("preserves default leaf wording for unhandled schema nodes", () => {
		const DateSchema = Schema.declare(
			(input): input is Date => input instanceof Date,
		);
		expect(validationIssues(DateSchema, "not-a-date")).toEqual([
			'Expected <Declaration>, actual "not-a-date"',
		]);

		const FilteredSchema = Schema.String.check(
			Schema.makeFilter(() => new SchemaIssue.UnexpectedKey(Schema.String.ast)),
		);
		expect(validationIssues(FilteredSchema, "excess")).toEqual([
			'Expected no excess property, actual "excess"',
		]);
	});

	it("formats non-JSON actual values without throwing", () => {
		const circular: { self?: unknown } = {};
		circular.self = circular;

		expect(validationIssues(Schema.String, circular)).toEqual([
			"Expected string, actual [object Object]",
		]);
	});

	it.each([
		{
			expected: [
				"schemaVersion: We can't read this project's metadata because it was saved by a different version of Forge.",
			],
			input: { modules: {}, schemaVersion: 2 },
			name: "custom schema-version sentence",
			schema: ManifestSchema,
		},
		{
			expected: [
				'config: Expected { readonly [x: string]: unknown }, actual "nope"',
				'config: Expected undefined, actual "nope"',
			],
			input: { config: "nope", modules: {}, schemaVersion: 1 },
			name: "record default branches",
			schema: ManifestSchema,
		},
		{
			expected: [
				"installs.0.definitionId: is missing",
				'installs: Expected undefined, actual [{"targets":[]}]',
			],
			input: { installs: [{ targets: [] }], modules: {}, schemaVersion: 1 },
			name: "missing nested keys",
			schema: ManifestSchema,
		},
		{
			expected: [
				'registries.0: Expected a string matching the pattern ^@[^/\\s]+\\/[^/\\s]+$, actual "notscoped"',
				'registries: Expected undefined, actual ["notscoped"]',
			],
			input: {
				modules: {},
				registries: ["notscoped"],
				schemaVersion: 1,
			},
			name: "checked registry patterns",
			schema: ManifestSchema,
		},
		{
			expected: ["Expected Struct (Encoded side), actual []"],
			input: [],
			name: "transformed top-level structs",
			schema: ManifestSchema,
		},
		{
			expected: [
				"modules: Expected { readonly [x: a string matching the pattern ^[a-z]{5}$]: (Struct (Encoded side) <-> Struct (Type side)) }, actual []",
			],
			input: { modules: [], schemaVersion: 1 },
			name: "checked record keys and transformed values",
			schema: ManifestSchema,
		},
		{
			expected: [
				'modules.abcde.definitionIds: Expected ReadonlyArray<string>, actual "garbage"',
				'modules.abcde.definitionIds: Expected undefined, actual "garbage"',
			],
			input: {
				modules: { abcde: { definitionIds: "garbage" } },
				schemaVersion: 1,
			},
			name: "deep array default branches",
			schema: ManifestSchema,
		},
		{
			expected: [
				"artifacts.a.path: is missing",
				'artifacts: Expected undefined, actual {"a":{"kind":"file","definitionIds":[],"hash":"h"}}',
			],
			input: {
				artifacts: {
					a: { kind: "file", definitionIds: [], hash: "h" },
				},
				schemaVersion: 1,
			},
			name: "lockfile missing keys",
			schema: LockfileSchema,
		},
		{
			expected: [
				'artifacts.a.base.semanticsVersion: Expected number, actual "one"',
				'artifacts.a.base: Expected undefined, actual {"hash":"b","mergeKind":"json","semanticsVersion":"one"}',
				'artifacts: Expected undefined, actual {"a":{"kind":"file","definitionIds":[],"hash":"h","path":"p","base":{"hash":"b","mergeKind":"json","semanticsVersion":"one"}}}',
			],
			input: {
				artifacts: {
					a: {
						kind: "file",
						definitionIds: [],
						hash: "h",
						path: "p",
						base: {
							hash: "b",
							mergeKind: "json",
							semanticsVersion: "one",
						},
					},
				},
				schemaVersion: 1,
			},
			name: "schema number fields",
			schema: LockfileSchema,
		},
		{
			expected: [
				'artifacts.a.base.mergeKind: Expected "json", actual "toml"',
				'artifacts.a.base.mergeKind: Expected "lines", actual "toml"',
				'artifacts.a.base.mergeKind: Expected "env", actual "toml"',
				'artifacts.a.base.mergeKind: Expected "opaque", actual "toml"',
				'artifacts.a.base: Expected undefined, actual {"hash":"b","mergeKind":"toml","semanticsVersion":1}',
				'artifacts: Expected undefined, actual {"a":{"kind":"file","definitionIds":[],"hash":"h","path":"p","base":{"hash":"b","mergeKind":"toml","semanticsVersion":1}}}',
			],
			input: {
				artifacts: {
					a: {
						kind: "file",
						definitionIds: [],
						hash: "h",
						path: "p",
						base: { hash: "b", mergeKind: "toml", semanticsVersion: 1 },
					},
				},
				schemaVersion: 1,
			},
			name: "nested literal and optional branches",
			schema: LockfileSchema,
		},
	] satisfies ReadonlyArray<{
		readonly expected: ReadonlyArray<string>;
		readonly input: unknown;
		readonly name: string;
		readonly schema: Schema.Codec<unknown, unknown, never, never>;
	}>)(
		"matches the v3 differential fixture for $name",
		({ expected, input, schema }) => {
			expect(validationIssues(schema, input)).toEqual(expected);
		},
	);

	it("pins the accepted v4 object-union collapse", () => {
		expect(
			validationIssues(ManifestSchema, {
				installs: [{ definitionId: "d", targets: [{ kind: "unsupported" }] }],
				modules: {},
				schemaVersion: 1,
			}),
		).toEqual([
			'installs.0.targets.0: Expected { readonly "kind": "project", ... } | { readonly "kind": "module", ... }, actual {"kind":"unsupported"}',
			'installs: Expected undefined, actual [{"definitionId":"d","targets":[{"kind":"unsupported"}]}]',
		]);
	});
});
