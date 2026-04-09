export { Apply } from "./apply";
export type {
	AddonDefinition,
	AddonId,
	AppCompatibility,
	AppManagedSurfaceName,
	AppSlotName,
	AppSurfaceName,
	CapabilityId,
	Compatibility,
	ConfigFragmentContribution,
	Contribution,
	CssContribution,
	DbSchemaContribution,
	DefinitionRegistry,
	DependencyContribution,
	DependencyRef,
	EnsuredModuleTarget,
	EnsureModuleContribution,
	EnvEntriesContribution,
	FrameworkDefinition,
	FrameworkId,
	JsonFileContribution,
	LeafTextFileContribution,
	LinesContribution,
	ManagedDependenciesSurfaceContribution,
	ManagedJsonSurfaceContribution,
	ManagedLinesSurfaceContribution,
	ManagedScriptsSurfaceContribution,
	ManagedSurfaceName,
	ManagedTextSurfaceContribution,
	ModuleCapabilitiesContribution,
	ModuleTarget,
	PackageCapabilityContribution,
	PackageCompatibility,
	PackageManagedSurfaceName,
	PackageSlotName,
	PackageSurfaceName,
	ProjectSurfaceName,
	ProjectTarget,
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
	appManagedSurfaceNames,
	appSlotNames,
	configFragment,
	defineAddon,
	defineFramework,
	defineRegistry,
	defineTemplate,
	dependencies,
	ensureAppModule,
	ensuredModuleTarget,
	ensurePackageModule,
	envEntries,
	isAddonCompatibleWithModule,
	jsonFile,
	leafTextFile,
	lines,
	lowerContributions,
	moduleCapabilities,
	packageManagedSurfaceNames,
	packageSlotNames,
	projectSurfaceNames,
	projectTarget,
	resolveDefinitions,
	scripts,
	selectedModuleTarget,
	surfaceDependencies,
	surfaceJson,
	surfaceLines,
	surfaceScripts,
	surfaceText,
	templateModuleTarget,
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
	ApplyError,
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
	PlannerError,
	RendererError,
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
export type { PlannedFile, ProjectPlan } from "./planner";
export { Planner } from "./planner";
export { Registry, resolve as resolveGenerators } from "./registry";
export type {
	ModuleBucketTarget,
	ProjectBucketTarget,
	RenderBucket,
	RenderedArtifact,
	SurfaceRenderContribution,
} from "./renderer";
export { Renderer } from "./renderer";
export type {
	InstallRecord,
	InstallTarget,
	Lockfile,
	Manifest,
	ModuleRecord,
	Provenance,
	ProvenanceArtifact,
	ProvenanceIndex,
} from "./state";
export {
	buildProvenanceIndex,
	LockfileSchema,
	ManifestSchema,
	ProvenanceSchema,
	State,
} from "./state";
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
