export type {
	AppConfig,
	Config,
	DiscoveredModule,
	ModuleId,
	PackageConfig,
	Slots,
	Template,
} from "./config";
export {
	AppConfigSchema,
	ConfigSchema,
	ConfigStore,
	ModuleIdSchema,
	PackageConfigSchema,
	SlotsSchema,
	TemplateSchema,
} from "./config";
export type {
	AcceptIncoming,
	BothModified,
	FileConflict,
	KeepCurrent,
	Merge,
	Resolution,
	UserDeleted,
	UserModified,
} from "./conflicts";
export type { EnvironmentCheck, PackageManager, Runtime } from "./environment";
export {
	checkPackageManager,
	checkRuntime,
	packageManagerCommand,
	packageManagers,
	runtimeCommand,
	runtimes,
} from "./environment";
export {
	AggregateConflictError,
	ConflictError,
	CyclicDependencyError,
	DiscoveryError,
	DuplicateModuleIdError,
	ExclusiveCategoryError,
	GeneratorError,
	ModuleConfigError,
	ModuleIdGenerationError,
	ParseError,
	StateError,
} from "./errors";
export type { FormatJsonOptions } from "./format/json";
export { formatJson } from "./format/json";
export type { Generator, GeneratorCategory } from "./generator";
export { defineGenerator } from "./generator";
export {
	deepMerge,
	mergeJson,
	threeWayMergeJson,
} from "./merge/json";
export type { LineMergeResult } from "./merge/lines";
export { appendLines, threeWayMergeLines } from "./merge/lines";
export type {
	AddDependencies,
	AddScripts,
	AppendLines,
	CreateFile,
	CreateJson,
	Dependency,
	FileOperation,
	FilePath,
	MergeJson,
} from "./operations";
export { filePath } from "./operations";
export { run, topologicalSort } from "./pipeline";
export { resolve as resolveGenerators } from "./registry";
export type { Lockfile, Manifest } from "./state";
export { LockfileSchema, ManifestSchema, State } from "./state";
export type {
	ConflictStrategy,
	ResolvedFile,
	ResolveOptions,
	VirtualFs,
} from "./virtual-fs";
export {
	addOperations,
	detectConflicts,
	empty as emptyVfs,
	resolve as resolveVfs,
} from "./virtual-fs";
