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
	Contribution,
	DefinitionRegistry,
	DependencyRef,
	EnsuredModuleTarget,
	EnsureModuleContribution,
	FrameworkDefinition,
	FrameworkId,
	GeneratorCategory,
	LeafTextFileContribution,
	ManagedDependenciesSurfaceContribution,
	ManagedJsonSurfaceContribution,
	ManagedLinesSurfaceContribution,
	ManagedScriptsSurfaceContribution,
	ManagedSurfaceName,
	ManagedTextSurfaceContribution,
	ModuleCapabilitiesContribution,
	ModuleTarget,
	PackageCompatibility,
	PackageManagedSurfaceName,
	PackageSlotName,
	PackageSurfaceName,
	ProjectSurfaceName,
	ProjectTarget,
	SlotPath,
	TargetMode,
	TemplateDefinition,
	TemplateId,
	TemplateRef,
} from "./authoring";
export {
	appManagedSurfaceNames,
	appSlotNames,
	defineAddon,
	defineFramework,
	defineRegistry,
	defineTemplate,
	ensureAppModule,
	ensuredModuleTarget,
	ensurePackageModule,
	isAddonCompatibleWithModule,
	leafTextFile,
	moduleCapabilities,
	packageManagedSurfaceNames,
	packageSlotNames,
	projectSurfaceNames,
	projectTarget,
	resolveSlotPath,
	SlotPathError,
	selectedModuleTarget,
	slotPath,
	surfaceDependencies,
	surfaceJson,
	surfaceLines,
	surfaceScripts,
	surfaceText,
	templateModuleTarget,
	validateAddonAgainstSelection,
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
	EnvironmentCheck,
	PackageManager,
	PackageManagerId,
	Runtime,
} from "./environment";
export {
	checkPackageManager,
	checkRuntime,
	dependencyFormatFor,
	Environment,
	isPackageManager,
	packageManagerCommand,
	packageManagers,
	runtimeCommand,
	runtimes,
} from "./environment";
export {
	ApplyError,
	CommandProbeError,
	DiscoveryError,
	DuplicateModuleIdError,
	GeneratorError,
	ModuleConfigError,
	ModuleIdGenerationError,
	PlannerError,
	RendererError,
	StateError,
} from "./errors";
export type { FormatJsonOptions } from "./format/json";
export { formatJson } from "./format/json";
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
	Dependency,
	DependencyFormat,
	FilePath,
} from "./operations";
export {
	defaultDependencyFormat,
	dependencyValue,
	filePath,
} from "./operations";
export type { PlannedFile, ProjectPlan } from "./planner";
export { Planner } from "./planner";
export type {
	ModuleBucketTarget,
	ProjectBucketTarget,
	RenderBucket,
	RenderedArtifact,
	SurfaceRenderContribution,
} from "./renderer";
export { Renderer } from "./renderer";
export type {
	ArtifactIndex,
	InstallRecord,
	InstallTarget,
	Lockfile,
	LockfileArtifact,
	LockfileArtifactKind,
	Manifest,
	ModuleRecord,
} from "./state";
export {
	buildArtifactIndex,
	defaultLockfile,
	defaultManifest,
	LockfileSchema,
	ManifestSchema,
	State,
} from "./state";
