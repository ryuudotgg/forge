export type {
	AcceptIncoming,
	BothModified,
	FileConflict,
	KeepCurrent,
	Merge,
	Resolution,
	UserDeleted,
	UserModified,
} from "./Conflicts";
export {
	ConflictError,
	CyclicDependencyError,
	GeneratorError,
	ManifestNotFoundError,
} from "./Errors";
export type { Generator } from "./Generator";
export { defineGenerator } from "./Generator";
export type { Lockfile } from "./Lockfile";
export {
	LockfileSchema,
	read as readLockfile,
	write as writeLockfile,
} from "./Lockfile";
export type { Manifest } from "./Manifest";
export {
	ManifestSchema,
	read as readManifest,
	write as writeManifest,
} from "./Manifest";
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
} from "./Operations";
export { filePath } from "./Operations";
export { run, topologicalSort } from "./Pipeline";
export { resolve as resolveGenerators } from "./Registry";
export type { ResolvedFile, VirtualFs } from "./VirtualFs";
export {
	addOperations,
	detectConflicts,
	empty as emptyVfs,
	resolve as resolveVfs,
} from "./VirtualFs";
