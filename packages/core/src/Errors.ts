import { Schema } from "effect";

export class GeneratorError extends Schema.TaggedError<GeneratorError>()(
	"GeneratorError",
	{
		generatorId: Schema.String,
		message: Schema.String,
	},
) {}

export class ConflictError extends Schema.TaggedError<ConflictError>()(
	"ConflictError",
	{
		path: Schema.String,
		generators: Schema.Array(Schema.String),
		message: Schema.String,
	},
) {}

export class CyclicDependencyError extends Schema.TaggedError<CyclicDependencyError>()(
	"CyclicDependencyError",
	{
		cycle: Schema.Array(Schema.String),
		message: Schema.String,
	},
) {}

export class ManifestNotFoundError extends Schema.TaggedError<ManifestNotFoundError>()(
	"ManifestNotFoundError",
	{
		projectRoot: Schema.String,
		message: Schema.String,
	},
) {}
