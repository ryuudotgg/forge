export type {
	ApplyConflict,
	ApplyOptions,
	ApplyPlan,
	ApplyRefusal,
	ApplyResolution,
	ApplyResult,
	ConflictResolution,
	DeclinedChange,
	DepartingAddons,
	DroppedEdit,
	FormatApplyErrorOptions,
	PlannedWrite,
	ResolutionFlag,
	ResolutionPolicy,
} from "./apply";
export {
	Apply,
	describeConflictValue,
	formatApplyError,
	isUserOwnedEnv,
} from "./apply";
export type {
	AdapterContext,
	AdapterDefinition,
	AdapterModule,
	AddonDefinition,
	AddonId,
	AddonSwitching,
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
	ModuleDestination,
	ModuleTarget,
	PackageCompatibility,
	PackageManagedSurfaceName,
	PackageSlotName,
	PackageSurfaceName,
	ProjectSurfaceName,
	ProjectTarget,
	ReadTemplate,
	RecipeMarkerValues,
	RenderedRecipeAsset,
	RenderRecipeValues,
	RequiredMarker,
	ResolvedModuleTarget,
	SharedAssetDefinition,
	SlotAssetDefinition,
	SlotPath,
	SourceRootDestination,
	TargetMode,
	TemplateAssetDefinition,
	TemplateAssetDestination,
	TemplateDefinition,
	TemplateId,
	TemplateMarker,
	TemplateRecipeDefinition,
	TemplateRef,
	ToggleInlineMarker,
	ToggleLineMarker,
	VariantAssetDefinition,
} from "./authoring";
export {
	addonDeclaresFramework,
	authoringApiVersion,
	defineAdapter,
	defineAddon,
	defineFramework,
	defineRegistry,
	defineTemplate,
	defineTemplateRecipe,
	deriveAddonFrameworks,
	ensureAppModule,
	ensuredModuleTarget,
	ensurePackageModule,
	inModule,
	inSourceRoot,
	interpolate,
	isAddonCompatibleWithModule,
	leafTextFile,
	marker,
	moduleCapabilities,
	moduleTarget,
	packageManagedSurfaceNames,
	packageSlotNames,
	projectSurfaceNames,
	projectTarget,
	renderRecipeAsset,
	resolveSlotPath,
	SlotPathError,
	selectedModuleTarget,
	sharedAsset,
	slotAsset,
	slotPath,
	surfaceDependencies,
	surfaceJson,
	surfaceLines,
	surfaceScripts,
	surfaceText,
	templateModuleTarget,
	validateAdapterAgainstModule,
	validateAddonAgainstSelection,
	validateTemplateRecipes,
	variantAsset,
} from "./authoring";
export { CliVersion, compareCliVersions } from "./cli-version";
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
	GITIGNORED_MODULE_DIRS,
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
	buildPackageManagerCheck,
	checkPackageManager,
	checkPackageManagerInstalled,
	checkRuntime,
	dependencyFormatFor,
	Environment,
	isPackageManager,
	packageManagerAddDevCommand,
	packageManagerCommand,
	packageManagerExecCommand,
	packageManagerInstallCommand,
	packageManagerRemoveCommand,
	packageManagers,
	packageManagerViewCommand,
	runtimeCommand,
	runtimes,
} from "./environment";
export {
	ApplyError,
	ApplyErrors,
	ApplyRefusalReason,
	CommandProbeError,
	DiscoveryError,
	DuplicateModuleIdError,
	GeneratorError,
	ModuleConfigError,
	ModuleIdGenerationError,
	PlannerError,
	PlannerErrors,
	Refusal,
	RegistryError,
	RegistryErrors,
	RendererError,
	StateError,
	StateErrors,
	SubprocessError,
} from "./errors";
export type { FormatJsonOptions } from "./format/json";
export { formatJson } from "./format/json";
export type { ReferenceHit, ReferenceToken, WorkingTreeStatus } from "./git";
export {
	GitError,
	referenceHits,
	trackedFiles,
	trackedReferenceHits,
	workingTreeStatus,
} from "./git";
export { hashContentHex } from "./hash";
export type { FormattedSchemaIssue } from "./json";
export {
	decodeJsonString,
	formatSchemaError,
	formatSchemaIssues,
} from "./json";
export { CoreLive } from "./layer";
export { envResidue, threeWayMergeEnv } from "./merge/env";
export type { JsonMergeResult } from "./merge/json";
export {
	deepMerge,
	formatJsonPath,
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
export { threeWayMergeYaml } from "./merge/yaml";
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
export type {
	InstalledPlanningSeed,
	PlannedFile,
	ProjectPlan,
} from "./planner";
export { Planner } from "./planner";
export type { DirectoryMove } from "./relocation";
export { moveModules } from "./relocation";
export type {
	ModuleBucketTarget,
	ProjectBucketTarget,
	RenderBucket,
	RenderedArtifact,
	SurfaceRenderContribution,
} from "./renderer";
export { Renderer } from "./renderer";
export type { ImportOrder } from "./sort/imports";
export type {
	ArtifactBase,
	ArtifactIndex,
	ArtifactMergeKind,
	FileMergeKind,
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
	SURFACE_MERGE_SEMANTICS_VERSION,
} from "./state";
export type {
	SubprocessInput,
	SubprocessOutputMode,
	SubprocessResult,
} from "./subprocess";
export {
	LONG_RUNNING_TIMEOUT_MS,
	PROBE_MAX_OUTPUT_BYTES,
	PROBE_TIMEOUT_MS,
	Subprocess,
} from "./subprocess";
