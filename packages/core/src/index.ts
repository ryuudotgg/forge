export type {
	AddonDefinition,
	AddonId,
	AppCompatibility,
	AppSlotName,
	CapabilityId,
	Compatibility,
	ConfigFragmentContribution,
	Contribution,
	CssContribution,
	DbSchemaContribution,
	DefinitionRegistry,
	DependencyContribution,
	DependencyRef,
	EnvEntriesContribution,
	FrameworkDefinition,
	FrameworkId,
	JsonFileContribution,
	LinesContribution,
	PackageCapabilityContribution,
	PackageCompatibility,
	PackageSlotName,
	ProviderWrapperContribution,
	RouteHandlerContribution,
	ScriptContribution,
	TargetMode,
	TemplateDefinition,
	TemplateId,
	TemplateRef,
	TextFileContribution,
	UtilityExportContribution,
} from "./authoring";
export {
	appSlotNames,
	configFragment,
	defineAddon,
	defineFramework,
	defineRegistry,
	defineTemplate,
	dependencies,
	envEntries,
	isAddonCompatibleWithModule,
	jsonFile,
	lines,
	lowerContributions,
	packageSlotNames,
	resolveDefinitions,
	scripts,
	textFile,
} from "./authoring";
export { CommandProbe } from "./command";
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
	Environment,
	packageManagerCommand,
	packageManagers,
	runtimeCommand,
	runtimes,
} from "./environment";
export {
	AggregateConflictError,
	CommandProbeError,
	ConflictError,
	CyclicDependencyError,
	DiscoveryError,
	DuplicateModuleIdError,
	ExclusiveCategoryError,
	GeneratorError,
	ModuleConfigError,
	ModuleIdGenerationError,
	ParseError,
	PipelineError,
	StateError,
} from "./errors";
export type { FormatJsonOptions } from "./format/json";
export { formatJson } from "./format/json";
export type { Generator, GeneratorCategory } from "./generator";
export { defineGenerator } from "./generator";
export { decodeJsonString, formatSchemaIssues } from "./json";
export { CoreLive } from "./layer";
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
export { hashContent, Pipeline, run, topologicalSort } from "./pipeline";
export { Registry, resolve as resolveGenerators } from "./registry";
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
	Vfs,
} from "./virtual-fs";
