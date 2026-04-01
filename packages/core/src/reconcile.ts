import { FileSystem } from "@effect/platform";
import { Effect, Schema } from "effect";
import { ReconcileError } from "./errors";
import type { Generator } from "./generator";
import * as Lockfile from "./lockfile";
import type { Manifest } from "./manifest";
import * as ManifestMod from "./manifest";
import { threeWayMergeJson } from "./merge/json";
import { threeWayMergeLines } from "./merge/lines";
import type { FilePath } from "./operations";
import { filePath } from "./operations";
import { hashContent, topologicalSort, validateExclusivity } from "./pipeline";
import { resolve } from "./registry";
import type { ResolvedFile } from "./virtual-fs";
import * as VFS from "./virtual-fs";

export interface WriteItem {
	readonly _tag: "Write";
	readonly path: FilePath;
	readonly content: string;
}

export interface DeleteItem {
	readonly _tag: "Delete";
	readonly path: FilePath;
}

export interface MergeConflictItem {
	readonly _tag: "MergeConflict";
	readonly path: FilePath;
	readonly base: string;
	readonly current: string;
	readonly incoming: string;
	readonly merged: string;
	readonly conflictPaths: ReadonlyArray<string>;
}

export interface OfflineConflictItem {
	readonly _tag: "OfflineConflict";
	readonly path: FilePath;
	readonly current: string;
	readonly incoming: string;
}

export interface UserDeletedItem {
	readonly _tag: "UserDeleted";
	readonly path: FilePath;
	readonly incoming: string;
}

export type PlanItem =
	| WriteItem
	| DeleteItem
	| MergeConflictItem
	| OfflineConflictItem
	| UserDeletedItem;

export interface ReconcilePlan {
	readonly items: ReadonlyArray<PlanItem>;
	readonly manifest: Manifest;
	readonly incomingResolved: ReadonlyArray<ResolvedFile>;
}

export interface AcceptIncoming {
	readonly _tag: "AcceptIncoming";
}

export interface KeepCurrent {
	readonly _tag: "KeepCurrent";
}

export interface MergeContent {
	readonly _tag: "Merge";
	readonly content: string;
}

export interface Overwrite {
	readonly _tag: "Overwrite";
}

export interface Skip {
	readonly _tag: "Skip";
}

export type ConflictResolution =
	| AcceptIncoming
	| KeepCurrent
	| MergeContent
	| Overwrite
	| Skip;

export interface ResolvedConflict {
	readonly path: FilePath;
	readonly resolution: ConflictResolution;
}

export interface ReconcileOptions<Config extends Record<string, unknown>> {
	readonly projectRoot: string;
	readonly newConfig: Config;
	readonly configSchema: Schema.Schema<Config>;
	readonly newGenerators: ReadonlyArray<Generator<Config>>;
	readonly baseGenerators: ReadonlyArray<Generator<Config>> | null;
}

export function reconcile<Config extends Record<string, unknown>>(
	options: ReconcileOptions<Config>,
) {
	return Effect.gen(function* () {
		const { projectRoot, newConfig, newGenerators, baseGenerators } = options;
		const fs = yield* FileSystem.FileSystem;

		const manifest = yield* ManifestMod.read(projectRoot);
		const lockfile = yield* Lockfile.read(projectRoot);
		const baseConfig = yield* Schema.decodeUnknown(options.configSchema)(
			manifest.config,
		).pipe(
			Effect.mapError(
				() =>
					new ReconcileError({
						path: ".forge/manifest.json",
						message: "Stored Config Does Not Match Expected Schema",
					}),
			),
		);

		const incoming = yield* generateResolved(newConfig, newGenerators);
		const incomingByPath = new Map(incoming.resolved.map((f) => [f.path, f]));

		let baseByPath: Map<FilePath, ResolvedFile> | null = null;
		if (baseGenerators) {
			const base = yield* generateResolved(baseConfig, baseGenerators);
			baseByPath = new Map(base.resolved.map((f) => [f.path, f]));
		}

		const items: PlanItem[] = [];

		for (const file of incoming.resolved) {
			const lockEntry = lockfile.files[file.path];

			if (!lockEntry) {
				items.push({ _tag: "Write", path: file.path, content: file.content });
				continue;
			}

			const fullPath = `${projectRoot}/${file.path}`;
			const exists = yield* fs.exists(fullPath);

			if (!exists) {
				items.push({
					_tag: "UserDeleted",
					path: file.path,
					incoming: file.content,
				});
				continue;
			}

			const currentContent = yield* fs.readFileString(fullPath);
			const currentHash = `sha256:${yield* hashContent(currentContent)}`;

			if (currentHash === lockEntry.hash) {
				items.push({ _tag: "Write", path: file.path, content: file.content });
				continue;
			}

			if (baseByPath) {
				const baseFile = baseByPath.get(file.path);
				if (baseFile) {
					const item = mergeFile(
						file.path,
						baseFile.content,
						currentContent,
						file.content,
					);
					items.push(item);
				} else {
					items.push({
						_tag: "Write",
						path: file.path,
						content: file.content,
					});
				}
			} else {
				items.push({
					_tag: "OfflineConflict",
					path: file.path,
					current: currentContent,
					incoming: file.content,
				});
			}
		}

		for (const path of Object.keys(lockfile.files)) {
			const fp = filePath(path);
			if (!incomingByPath.has(fp)) items.push({ _tag: "Delete", path: fp });
		}

		const newManifest: Manifest = {
			version: 1,
			config: newConfig,
			generators: incoming.ordered.map((g) => ({
				id: g.id,
				version: g.version,
			})),
		};

		return {
			items,
			manifest: newManifest,
			incomingResolved: incoming.resolved,
		} satisfies ReconcilePlan;
	});
}

export function applyPlan(
	plan: ReconcilePlan,
	resolutions: ReadonlyArray<ResolvedConflict>,
	projectRoot: string,
) {
	return Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const oldLockfile = yield* Lockfile.read(projectRoot);
		const resolutionMap = new Map(
			resolutions.map((r) => [r.path, r.resolution]),
		);

		const written = new Map<
			FilePath,
			{ content: string; generators: ReadonlyArray<string> }
		>();

		const incomingGenerators = new Map(
			plan.incomingResolved.map((f) => [f.path, f.generators]),
		);

		for (const item of plan.items) {
			const fullPath = `${projectRoot}/${item.path}`;
			const dir = fullPath.slice(0, fullPath.lastIndexOf("/"));
			const generators = incomingGenerators.get(item.path) ?? [];

			switch (item._tag) {
				case "Write": {
					yield* fs.makeDirectory(dir, { recursive: true });
					yield* fs.writeFileString(fullPath, item.content);
					written.set(item.path, { content: item.content, generators });
					break;
				}

				case "Delete": {
					const exists = yield* fs.exists(fullPath);
					if (exists) yield* fs.remove(fullPath);
					break;
				}

				case "MergeConflict":
				case "OfflineConflict":
				case "UserDeleted": {
					const resolution = resolutionMap.get(item.path);
					if (!resolution) continue;

					const content = yield* resolveConflictContent(
						fs,
						fullPath,
						item,
						resolution,
					);

					if (content !== null) {
						yield* fs.makeDirectory(dir, { recursive: true });
						yield* fs.writeFileString(fullPath, content);
						written.set(item.path, { content, generators });
					} else {
						const exists = yield* fs.exists(fullPath);
						if (exists) {
							const current = yield* fs.readFileString(fullPath);
							const oldGenerators =
								oldLockfile.files[item.path]?.generators ?? [];
							written.set(item.path, {
								content: current,
								generators: oldGenerators,
							});
						}
					}
					break;
				}
			}
		}

		const lockfileEntries: Record<
			string,
			{ generators: string[]; hash: string }
		> = {};

		for (const [path, { content, generators }] of written) {
			const hash = yield* hashContent(content);
			lockfileEntries[path] = {
				generators: [...generators],
				hash: `sha256:${hash}`,
			};
		}

		const lockfile: Lockfile.Lockfile = { files: lockfileEntries };

		yield* Lockfile.write(projectRoot, lockfile);
		yield* ManifestMod.write(projectRoot, plan.manifest);

		return { lockfile, manifest: plan.manifest };
	});
}

function generateResolved<Config extends Record<string, unknown>>(
	config: Config,
	generators: ReadonlyArray<Generator<Config>>,
) {
	return Effect.gen(function* () {
		const applicable = resolve(config, generators);
		yield* validateExclusivity(applicable);
		const ordered = yield* topologicalSort(applicable);

		let vfs = VFS.empty();
		for (const generator of ordered) {
			const ops = yield* generator.generate(config);
			vfs = VFS.addOperations(vfs, generator.id, ops);
		}

		const resolved = yield* VFS.resolve(vfs);
		return { resolved, ordered };
	});
}

function mergeFile(
	path: FilePath,
	base: string,
	current: string,
	incoming: string,
): PlanItem {
	const isJson = path.endsWith(".json") || path.endsWith(".jsonc");

	if (isJson) {
		try {
			const baseParsed: unknown = JSON.parse(stripJsonComments(base));
			const currentParsed: unknown = JSON.parse(stripJsonComments(current));
			const incomingParsed: unknown = JSON.parse(stripJsonComments(incoming));

			if (
				!isRecord(baseParsed) ||
				!isRecord(currentParsed) ||
				!isRecord(incomingParsed)
			)
				throw new TypeError("Expected JSON Object");

			const { merged, conflicts } = threeWayMergeJson(
				baseParsed,
				currentParsed,
				incomingParsed,
			);

			const mergedContent = `${JSON.stringify(merged, null, "\t")}\n`;

			if (conflicts.length === 0)
				return { _tag: "Write", path, content: mergedContent };

			return {
				_tag: "MergeConflict",
				path,
				base,
				current,
				incoming,
				merged: mergedContent,
				conflictPaths: conflicts,
			};
		} catch {}
	}

	const { merged, conflicts } = threeWayMergeLines(base, current, incoming);

	if (conflicts.length === 0) return { _tag: "Write", path, content: merged };

	return {
		_tag: "MergeConflict",
		path,
		base,
		current,
		incoming,
		merged,
		conflictPaths: conflicts,
	};
}

function stripJsonComments(content: string): string {
	let result = "";
	let i = 0;
	const len = content.length;

	while (i < len) {
		if (content[i] === '"') {
			result += '"';
			i++;
			while (i < len && content[i] !== '"') {
				if (content[i] === "\\") {
					result += content[i];
					i++;
					if (i < len) {
						result += content[i];
						i++;
					}
				} else {
					result += content[i];
					i++;
				}
			}
			if (i < len) {
				result += '"';
				i++;
			}
			continue;
		}

		if (content[i] === "/" && i + 1 < len && content[i + 1] === "/") {
			while (i < len && content[i] !== "\n") i++;
			continue;
		}

		if (content[i] === "/" && i + 1 < len && content[i + 1] === "*") {
			i += 2;
			while (i + 1 < len && !(content[i] === "*" && content[i + 1] === "/"))
				i++;
			if (i + 1 < len) i += 2;
			continue;
		}

		result += content[i];
		i++;
	}

	return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

const MAX_BACKUP_ATTEMPTS = 100;

function findBackupPath(fs: FileSystem.FileSystem, originalPath: string) {
	return Effect.gen(function* () {
		const lastDot = originalPath.lastIndexOf(".");
		const base = lastDot > 0 ? originalPath.slice(0, lastDot) : originalPath;
		const ext = lastDot > 0 ? originalPath.slice(lastDot) : "";

		for (let n = 1; n <= MAX_BACKUP_ATTEMPTS; n++) {
			const candidate = `${base}.old${String(n)}${ext}`;
			const exists = yield* fs.exists(candidate);
			if (!exists) return candidate;
		}

		return yield* new ReconcileError({
			path: originalPath,
			message: `Exceeded Maximum Backup Attempts (${String(MAX_BACKUP_ATTEMPTS)})`,
		});
	});
}

function resolveConflictContent(
	fs: FileSystem.FileSystem,
	fullPath: string,
	item: MergeConflictItem | OfflineConflictItem | UserDeletedItem,
	resolution: ConflictResolution,
) {
	return Effect.gen(function* () {
		switch (resolution._tag) {
			case "AcceptIncoming":
				return item.incoming;

			case "KeepCurrent":
			case "Skip":
				return null;

			case "Merge":
				return resolution.content;

			case "Overwrite": {
				const exists = yield* fs.exists(fullPath);
				if (exists) {
					const backupPath = yield* findBackupPath(fs, fullPath);
					const currentContent = yield* fs.readFileString(fullPath);
					yield* fs.writeFileString(backupPath, currentContent);
				}
				return item.incoming;
			}
		}
	});
}
