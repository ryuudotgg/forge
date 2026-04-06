import { Effect, Schema } from "effect";
import { ArrayFormatter } from "effect/ParseResult";

const ParsedJsonSchema = Schema.parseJson(Schema.Unknown);

export function formatSchemaIssues(
	issues: Parameters<typeof ArrayFormatter.formatErrorSync>[0],
) {
	return ArrayFormatter.formatErrorSync(issues).map((issue) =>
		issue.path.length > 0
			? `${issue.path.join(".")}: ${issue.message}`
			: issue.message,
	);
}

export function decodeJsonString<A, I, R, ParseError, ValidationError>(
	raw: string,
	schema: Schema.Schema<A, I, R>,
	options: {
		readonly onParseError: (message: string) => ParseError;
		readonly onValidationError: (
			issues: ReadonlyArray<string>,
		) => ValidationError;
	},
): Effect.Effect<A, ParseError | ValidationError, R> {
	return Schema.decodeUnknown(ParsedJsonSchema)(raw).pipe(
		Effect.mapError((error) => options.onParseError(String(error))),
		Effect.flatMap((parsed) =>
			Schema.decodeUnknown(schema)(parsed).pipe(
				Effect.mapError((issues) =>
					options.onValidationError(formatSchemaIssues(issues)),
				),
			),
		),
	);
}
