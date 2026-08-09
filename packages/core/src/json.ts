import { Effect, Schema, type SchemaAST, SchemaIssue } from "effect";
import type { Effect as EffectType } from "effect/Effect";

export interface FormattedSchemaIssue {
	readonly message: string;
	readonly path: ReadonlyArray<PropertyKey>;
}

function checkExpected(ast: SchemaAST.AST): string | undefined {
	const annotated = ast.annotations?.expected;
	if (typeof annotated === "string") return annotated;

	for (const check of ast.checks ?? []) {
		const expected = check.annotations?.expected;
		if (typeof expected === "string") return expected;
	}

	return undefined;
}

function hasEncodedProperty(ast: SchemaAST.Objects): boolean {
	return ast.propertySignatures.some(
		(property) => property.type.encoding !== undefined,
	);
}

function formatExpected(
	ast: SchemaAST.AST,
	position: "leaf" | "nested" = "nested",
): string | undefined {
	const checked = checkExpected(ast);
	if (checked !== undefined) return checked;

	switch (ast._tag) {
		case "String":
			return "string";
		case "Number":
			return "number";
		case "Boolean":
			return "boolean";
		case "Unknown":
			return "unknown";
		case "Undefined":
			return "undefined";
		case "Literal":
			return typeof ast.literal === "string"
				? JSON.stringify(ast.literal)
				: String(ast.literal);
		case "Union": {
			const members = ast.types.map((member) => formatExpected(member));
			return members.every((member) => member !== undefined)
				? members.join(" | ")
				: undefined;
		}
		case "Arrays": {
			if (ast.elements.length > 0 || ast.rest.length !== 1) return undefined;
			const memberAst = ast.rest[0];
			if (memberAst === undefined) return undefined;
			const member = formatExpected(memberAst);
			return member === undefined ? undefined : `ReadonlyArray<${member}>`;
		}
		case "Objects": {
			if (hasEncodedProperty(ast))
				return position === "leaf"
					? "Struct (Encoded side)"
					: "(Struct (Encoded side) <-> Struct (Type side))";

			const properties = ast.propertySignatures
				.map((property) => {
					const expected = formatExpected(property.type);
					return expected === undefined
						? undefined
						: `readonly ${String(property.name)}${property.type.context?.isOptional === true ? "?" : ""}: ${expected}`;
				})
				.filter((property): property is string => property !== undefined);
			const indexes = ast.indexSignatures
				.map((index) => {
					const parameter = formatExpected(index.parameter);
					const expected = formatExpected(index.type);
					return parameter === undefined || expected === undefined
						? undefined
						: `readonly [x: ${parameter}]: ${expected}`;
				})
				.filter((index): index is string => index !== undefined);
			const fields = [...properties, ...indexes];
			return fields.length ===
				ast.propertySignatures.length + ast.indexSignatures.length
				? `{ ${fields.join("; ")} }`
				: undefined;
		}
		default:
			return undefined;
	}
}

function flattenUnionMembers(
	members: ReadonlyArray<SchemaAST.AST>,
): ReadonlyArray<SchemaAST.AST> {
	return members.flatMap((member) =>
		member._tag === "Union" ? flattenUnionMembers(member.types) : [member],
	);
}

function formatLeaf(issue: SchemaIssue.Leaf): string {
	if (issue._tag === "MissingKey") {
		const message = SchemaIssue.defaultLeafHook(issue);
		return message === "Missing key" ? "is missing" : message;
	}
	if (issue._tag === "InvalidType") {
		const message = SchemaIssue.defaultLeafHook(issue);
		if (typeof issue.ast.annotations?.message === "string") return message;
		const expected = formatExpected(issue.ast, "leaf");
		return expected === undefined ? message : `Expected ${expected}`;
	}
	return SchemaIssue.defaultLeafHook(issue);
}

const fallbackFormatter = SchemaIssue.makeFormatterStandardSchemaV1({
	leafHook: formatLeaf,
});

function walkIssue(
	issue: SchemaIssue.Issue,
	path: ReadonlyArray<PropertyKey>,
): ReadonlyArray<FormattedSchemaIssue> {
	switch (issue._tag) {
		case "Filter": {
			const message = SchemaIssue.defaultCheckHook(issue);
			if (message !== undefined) return [{ message, path }];
			if (issue.issue._tag === "InvalidValue") {
				const expected = issue.filter.annotations?.expected;
				return [
					{
						message: `Expected ${typeof expected === "string" ? expected : "<filter>"}`,
						path,
					},
				];
			}
			return walkIssue(issue.issue, path);
		}
		case "Encoding":
			return walkIssue(issue.issue, path);
		case "Pointer":
			return walkIssue(issue.issue, [...path, ...issue.path]);
		case "Composite":
			return issue.issues.flatMap((child) => walkIssue(child, path));
		case "AnyOf": {
			if (issue.issues.length > 0) {
				const formatted = issue.issues.flatMap((child) =>
					walkIssue(child, path),
				);
				const additional = flattenUnionMembers(issue.ast.types)
					.filter(
						(member) =>
							member._tag === "Undefined" || member._tag === "Literal",
					)
					.flatMap((member) => {
						const expected = formatExpected(member);
						if (expected === undefined) return [];
						const message = `Expected ${expected}`;
						return formatted.some(
							(formattedIssue) =>
								formattedIssue.message === message &&
								formattedIssue.path.length === path.length &&
								formattedIssue.path.every(
									(segment, index) => segment === path[index],
								),
						)
							? []
							: [{ message, path }];
					});
				return [...formatted, ...additional];
			}
			const unionMembers = flattenUnionMembers(issue.ast.types);
			const members = unionMembers.map((member) => ({
				expected: formatExpected(member),
				isObject: member._tag === "Objects",
			}));
			const objectCount = members.filter((member) => member.isObject).length;
			if (
				objectCount < 2 &&
				members.every((member) => member.expected !== undefined)
			)
				return members.map((member) => ({
					message: `Expected ${member.expected ?? "unknown"}`,
					path,
				}));
			return fallbackFormatter(issue).issues.map((formatted) => ({
				message: formatted.message,
				path,
			}));
		}
		default:
			return [{ message: formatLeaf(issue), path }];
	}
}

const noInput = Symbol();

type ValueAtPathResult =
	| { readonly found: false }
	| { readonly found: true; readonly value: unknown };

function valueAtPath(
	input: unknown,
	path: ReadonlyArray<PropertyKey>,
): ValueAtPathResult {
	let current: unknown = input;
	for (const key of path) {
		if (
			typeof current !== "object" ||
			current === null ||
			!Object.hasOwn(current, key)
		)
			return { found: false };
		current = Reflect.get(current, key);
	}
	return { found: true, value: current };
}

function formatActual(value: unknown) {
	try {
		const json = JSON.stringify(value);
		return json === undefined ? String(value) : json;
	} catch {
		return String(value);
	}
}

function formatMessage(message: string, actual: unknown) {
	if (actual === undefined || !message.startsWith("Expected ")) return message;
	const expected = message
		.slice("Expected ".length)
		.split(" | ")
		.filter((member) => member !== "undefined");
	return expected.length === 0 ? message : `Expected ${expected.join(" | ")}`;
}

export function formatSchemaError(
	error: Schema.SchemaError,
	input: unknown = noInput,
): ReadonlyArray<FormattedSchemaIssue> {
	return walkIssue(error.issue, []).map((issue) => {
		const actual: ValueAtPathResult =
			input === noInput ? { found: false } : valueAtPath(input, issue.path);
		return {
			message:
				actual.found && issue.message.startsWith("Expected ")
					? `${formatMessage(issue.message, actual.value)}, actual ${formatActual(actual.value)}`
					: issue.message,
			path: issue.path,
		};
	});
}

export function formatSchemaIssues(error: Schema.SchemaError, input?: unknown) {
	return formatSchemaError(error, input).map((issue) =>
		issue.path.length > 0
			? `${issue.path.join(".")}: ${issue.message}`
			: issue.message,
	);
}

export function decodeJsonString<
	S extends Schema.Constraint,
	ParseError,
	ValidationError,
>(
	raw: string,
	schema: S,
	options: {
		readonly onParseError: (message: string, cause: unknown) => ParseError;
		readonly onValidationError: (
			issues: ReadonlyArray<string>,
			cause: unknown,
		) => ValidationError;
	},
): EffectType<S["Type"], ParseError | ValidationError, S["DecodingServices"]> {
	return Effect.try({
		try: (): unknown => JSON.parse(raw),
		catch: (cause) =>
			options.onParseError(
				cause instanceof Error ? cause.message : String(cause),
				cause,
			),
	}).pipe(
		Effect.flatMap((parsed) =>
			Schema.decodeUnknownEffect(schema)(parsed).pipe(
				Effect.mapError((error) =>
					options.onValidationError(formatSchemaIssues(error, parsed), error),
				),
			),
		),
	);
}
