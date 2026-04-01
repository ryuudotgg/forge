import { Effect } from "effect";
import { AggregateConflictError, ConflictError } from "./errors";
import { deepMerge, mergeJson } from "./merge/json";
import { appendLines } from "./merge/lines";
import type {
	AddDependencies,
	AddScripts,
	AppendLines,
	CreateFile,
	FileOperation,
	FilePath,
	MergeJson,
} from "./operations";

interface SourcedOperation {
	readonly generatorId: string;
	readonly operation: FileOperation;
}

export interface VirtualFs {
	readonly operations: Map<FilePath, SourcedOperation[]>;
}

export function empty(): VirtualFs {
	return { operations: new Map() };
}

export function addOperations(
	vfs: VirtualFs,
	generatorId: string,
	ops: ReadonlyArray<FileOperation>,
): VirtualFs {
	const next = new Map(vfs.operations);

	for (const operation of ops) {
		const path = getOperationPath(operation);
		const existing = next.get(path) ?? [];
		next.set(path, [...existing, { generatorId, operation }]);
	}

	return { operations: next };
}

function getOperationPath(op: FileOperation): FilePath {
	switch (op._tag) {
		case "CreateFile":
		case "MergeJson":
		case "AppendLines":
		case "AddDependencies":
		case "AddScripts":
			return op.path;
	}
}

export interface ResolvedFile {
	readonly path: FilePath;
	readonly content: string;
	readonly generators: ReadonlyArray<string>;
}

export function detectConflicts(vfs: VirtualFs) {
	return Effect.gen(function* () {
		const errors: ConflictError[] = [];

		for (const [path, sourced] of vfs.operations) {
			const creates = sourced.filter(
				(s) => s.operation._tag === "CreateFile" && !s.operation.overwrite,
			);

			if (creates.length > 1)
				errors.push(
					new ConflictError({
						path,
						generators: creates.map((c) => c.generatorId),
						message: `Multiple Generators Create ${path} Without Overwrite`,
					}),
				);
		}

		return errors;
	});
}

export function resolve(vfs: VirtualFs) {
	return Effect.gen(function* () {
		const conflicts = yield* detectConflicts(vfs);

		if (conflicts.length > 0)
			return yield* new AggregateConflictError({
				conflicts,
				message: conflicts.map((c) => c.message).join("\n"),
			});

		const resolved: ResolvedFile[] = [];

		for (const [path, sourced] of vfs.operations) {
			const generators = [...new Set(sourced.map((s) => s.generatorId))];
			const content = yield* resolveFileOperations(sourced);
			resolved.push({ path, content, generators });
		}

		return resolved;
	});
}

function resolveFileOperations(sourced: ReadonlyArray<SourcedOperation>) {
	return Effect.sync(() => {
		let content = "";

		const creates: CreateFile[] = [];
		const merges: MergeJson[] = [];
		const appends: AppendLines[] = [];
		const deps: AddDependencies[] = [];
		const scripts: AddScripts[] = [];

		for (const { operation } of sourced)
			switch (operation._tag) {
				case "CreateFile":
					creates.push(operation);
					break;

				case "MergeJson":
					merges.push(operation);
					break;

				case "AppendLines":
					appends.push(operation);
					break;

				case "AddDependencies":
					deps.push(operation);
					break;

				case "AddScripts":
					scripts.push(operation);
					break;
			}

		const lastCreate = creates[creates.length - 1];
		if (lastCreate) content = lastCreate.content;

		if (merges.length > 0 || deps.length > 0 || scripts.length > 0) {
			let json: Record<string, unknown> = content ? parseJson(content) : {};

			for (const merge of merges)
				json = mergeJson(json, merge.value, merge.strategy);

			if (deps.length > 0) json = applyDependencies(json, deps);
			if (scripts.length > 0) json = applyScripts(json, scripts);

			content = `${JSON.stringify(json, null, "\t")}\n`;
		}

		if (appends.length > 0) {
			for (const append of appends)
				content = appendLines(content, append.lines, append.section);
		}

		return content;
	});
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJson(content: string): Record<string, unknown> {
	const parsed: unknown = JSON.parse(content);
	return isRecord(parsed) ? parsed : {};
}

function applyDependencies(
	json: Record<string, unknown>,
	ops: ReadonlyArray<AddDependencies>,
): Record<string, unknown> {
	const result = { ...json };

	for (const op of ops)
		for (const dep of op.dependencies) {
			const section = dep.type;
			const existing =
				typeof result[section] === "object" && result[section] !== null
					? (result[section] as Record<string, unknown>)
					: {};

			result[section] = { ...existing, [dep.name]: dep.version };
		}

	return result;
}

function applyScripts(
	json: Record<string, unknown>,
	ops: ReadonlyArray<AddScripts>,
): Record<string, unknown> {
	let existing =
		typeof json.scripts === "object" && json.scripts !== null
			? (json.scripts as Record<string, unknown>)
			: {};

	for (const op of ops) existing = deepMerge(existing, op.scripts);

	return { ...json, scripts: existing };
}
