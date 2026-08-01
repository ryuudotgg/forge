export type { ApplyPlan, PlannedWrite } from "./apply";
export { Apply, formatApplyError } from "./apply";
export type {
	AdapterContext,
	AdapterDefinition,
	AdapterModule,
	AddonDefinition,
	AddonId,
	AppCompatibility,
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
	ResolvedModuleTarget,
	SlotPath,
	TargetMode,
	TemplateDefinition,
	TemplateId,
	TemplateRef,
} from "./authoring";
export {
	authoringApiVersion,
	defineAdapter,
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
	moduleTarget,
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
	validateAdapterAgainstModule,
	validateAddonAgainstSelection,
} from "./authoring";
export { CommandProbe, readPersistedCommandVersions } from "./command";
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
	packageManagerAddDevCommand,
	packageManagerCommand,
	packageManagerRemoveCommand,
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
	RegistryError,
	RendererError,
	StateError,
} from "./errors";
export type { FormatJsonOptions } from "./format/json";
export { formatJson } from "./format/json";
export { decodeJsonString, formatSchemaIssues } from "./json";
export { CoreLive } from "./layer";
export { envResidue, threeWayMergeEnv } from "./merge/env";
export type { JsonMergeResult } from "./merge/json";
export {
	deepMerge,
	jsonResidue,
	mergeJson,
	threeWayMergeJson,
} from "./merge/json";
export type { LineMergeConflict, LineMergeResult } from "./merge/lines";
export {
	appendLines,
	parseSections,
	sectionResidue,
	threeWayMergeLines,
	threeWayMergeSections,
} from "./merge/lines";
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
	ArtifactBase,
	ArtifactIndex,
	InstallRecord,
	InstallTarget,
	Lockfile,
	LockfileArtifact,
	LockfileArtifactKind,
	Manifest,
	ModuleRecord,
	RegistryDescriptor,
	RegistryUnit,
	StateBundle,
	SurfaceMergeKind,
} from "./state";
export {
	buildArtifactIndex,
	defaultLockfile,
	defaultManifest,
	LockfileSchema,
	ManifestSchema,
	RegistryDescriptorSchema,
	State,
} from "./state";
