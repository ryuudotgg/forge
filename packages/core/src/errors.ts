import { Schema } from "effect";

export class GeneratorError extends Schema.TaggedError<GeneratorError>()(
	"GeneratorError",
	{ generatorId: Schema.String, message: Schema.String },
) {}

export class CommandProbeError extends Schema.TaggedError<CommandProbeError>()(
	"CommandProbeError",
	{
		command: Schema.String,
		message: Schema.String,
		detail: Schema.String,
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
	{ cycle: Schema.Array(Schema.String), message: Schema.String },
) {}

export class AggregateConflictError extends Schema.TaggedError<AggregateConflictError>()(
	"AggregateConflictError",
	{
		conflicts: Schema.Array(
			Schema.Struct({
				path: Schema.String,
				generators: Schema.Array(Schema.String),
				message: Schema.String,
			}),
		),
		message: Schema.String,
	},
) {}

export class ExclusiveCategoryError extends Schema.TaggedError<ExclusiveCategoryError>()(
	"ExclusiveCategoryError",
	{
		category: Schema.String,
		generators: Schema.Array(Schema.String),
		message: Schema.String,
	},
) {}

export class ParseError extends Schema.TaggedError<ParseError>()("ParseError", {
	filePath: Schema.String,
	message: Schema.String,
}) {}

export class ModuleConfigError extends Schema.TaggedError<ModuleConfigError>()(
	"ModuleConfigError",
	{ filePath: Schema.String, message: Schema.String },
) {}

export class DuplicateModuleIdError extends Schema.TaggedError<DuplicateModuleIdError>()(
	"DuplicateModuleIdError",
	{
		moduleId: Schema.String,
		firstPath: Schema.String,
		secondPath: Schema.String,
		message: Schema.String,
	},
) {}

export class ModuleIdGenerationError extends Schema.TaggedError<ModuleIdGenerationError>()(
	"ModuleIdGenerationError",
	{ message: Schema.String },
) {}

export class StateError extends Schema.TaggedError<StateError>()("StateError", {
	filePath: Schema.String,
	message: Schema.String,
}) {}

export class DiscoveryError extends Schema.TaggedError<DiscoveryError>()(
	"DiscoveryError",
	{ path: Schema.String, message: Schema.String },
) {}

export class PipelineError extends Schema.TaggedError<PipelineError>()(
	"PipelineError",
	{ path: Schema.String, message: Schema.String },
) {}

export class PlannerError extends Schema.TaggedError<PlannerError>()(
	"PlannerError",
	{ path: Schema.String, message: Schema.String },
) {}

export class RendererError extends Schema.TaggedError<RendererError>()(
	"RendererError",
	{ path: Schema.String, message: Schema.String },
) {}

export class ApplyError extends Schema.TaggedError<ApplyError>()("ApplyError", {
	path: Schema.String,
	message: Schema.String,
}) {}
