import { Schema } from "effect";

export const FilePath = Schema.String.pipe(Schema.brand("FilePath"));
export type FilePath = typeof FilePath.Type;

export const filePath = Schema.decodeSync(FilePath);

export interface CreateFile {
	readonly _tag: "CreateFile";
	readonly path: FilePath;
	readonly content: string;
	readonly overwrite: boolean;
}

export interface MergeJson {
	readonly _tag: "MergeJson";
	readonly path: FilePath;
	readonly value: Record<string, unknown>;
	readonly strategy: "deep" | "replace";
}

export interface AppendLines {
	readonly _tag: "AppendLines";
	readonly path: FilePath;
	readonly lines: ReadonlyArray<string>;
	readonly section?: string;
}

export interface Dependency {
	readonly name: string;
	readonly version: string;
	readonly type: "dependencies" | "devDependencies" | "peerDependencies";
	readonly catalog?: string;
}

export interface AddDependencies {
	readonly _tag: "AddDependencies";
	readonly path: FilePath;
	readonly dependencies: ReadonlyArray<Dependency>;
}

export interface AddScripts {
	readonly _tag: "AddScripts";
	readonly path: FilePath;
	readonly scripts: Record<string, string>;
}

export type FileOperation =
	| CreateFile
	| MergeJson
	| AppendLines
	| AddDependencies
	| AddScripts;
