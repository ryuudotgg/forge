import type { FilePath } from "./Operations";

export interface UserModified {
	readonly _tag: "UserModified";
	readonly path: FilePath;
	readonly base: string;
	readonly current: string;
	readonly incoming: string;
}

export interface UserDeleted {
	readonly _tag: "UserDeleted";
	readonly path: FilePath;
	readonly incoming: string;
}

export interface BothModified {
	readonly _tag: "BothModified";
	readonly path: FilePath;
	readonly base: string;
	readonly current: string;
	readonly incoming: string;
}

export type FileConflict = UserModified | UserDeleted | BothModified;

export interface AcceptIncoming {
	readonly _tag: "AcceptIncoming";
}

export interface KeepCurrent {
	readonly _tag: "KeepCurrent";
}

export interface Merge {
	readonly _tag: "Merge";
	readonly content: string;
}

export type Resolution = AcceptIncoming | KeepCurrent | Merge;
