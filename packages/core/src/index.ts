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
export {
	AggregateConflictError,
	ConflictError,
	CyclicDependencyError,
	ExclusiveCategoryError,
	GeneratorError,
	ManifestNotFoundError,
	ParseError,
	ReconcileError,
} from "./errors";
export type { Generator, GeneratorCategory } from "./generator";
export { defineGenerator } from "./generator";
export type { Lockfile } from "./lockfile";
export {
	LockfileSchema,
	read as readLockfile,
	write as writeLockfile,
} from "./lockfile";
export type { Manifest } from "./manifest";
export {
	ManifestSchema,
	read as readManifest,
	write as writeManifest,
} from "./manifest";
export { deepMerge, mergeJson, threeWayMergeJson } from "./merge/json";
export { appendLines, threeWayMergeLines } from "./merge/lines";
export type {
	AddDependencies,
	AddScripts,
	AppendLines,
	CreateFile,
	Dependency,
	FileOperation,
	FilePath,
	MergeJson,
} from "./operations";
export { filePath } from "./operations";
export { run, topologicalSort } from "./pipeline";
export type {
	ConflictResolution,
	DeleteItem,
	MergeConflictItem,
	OfflineConflictItem,
	PlanItem,
	ReconcileOptions,
	ReconcilePlan,
	ResolvedConflict,
	UserDeletedItem,
	WriteItem,
} from "./reconcile";
export { applyPlan, reconcile } from "./reconcile";
export { resolve as resolveGenerators } from "./registry";
export type { ResolvedFile, VirtualFs } from "./virtual-fs";
export {
	addOperations,
	detectConflicts,
	empty as emptyVfs,
	resolve as resolveVfs,
} from "./virtual-fs";
