import { FileSystem } from "@effect/platform";
import { Effect } from "effect";
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

// ---------------------------------------------------------------------------
// Plan item types
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Resolution types for conflicts
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// reconcile — compute a plan by diffing old vs new generator output
// ---------------------------------------------------------------------------

export interface ReconcileOptions<Config extends Record<string, unknown>> {
	readonly projectRoot: string;
	readonly newConfig: Config;
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
		const baseConfig = manifest.config as Config;

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

			// Layer 1: hash check — user didn't modify, safe to overwrite
			if (currentHash === lockEntry.hash) {
				items.push({ _tag: "Write", path: file.path, content: file.content });
				continue;
			}

			// User modified the file
			if (baseByPath) {
				// Layer 2: online — three-way merge
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
					// File wasn't in base output but is in lockfile — generator is new
					items.push({
						_tag: "Write",
						path: file.path,
						content: file.content,
					});
				}
			} else {
				// Layer 3: offline — can't compute base
				items.push({
					_tag: "OfflineConflict",
					path: file.path,
					current: currentContent,
					incoming: file.content,
				});
			}
		}

		// Files in lockfile but not in incoming — generator was removed
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

// ---------------------------------------------------------------------------
// applyPlan — write the reconciled plan to disk
// ---------------------------------------------------------------------------

export function applyPlan(
	plan: ReconcilePlan,
	resolutions: ReadonlyArray<ResolvedConflict>,
	projectRoot: string,
) {
	return Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
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
						// KeepCurrent or Skip — file unchanged, still track it
						const exists = yield* fs.exists(fullPath);
						if (exists) {
							const current = yield* fs.readFileString(fullPath);
							written.set(item.path, { content: current, generators });
						}
					}
					break;
				}
			}
		}

		// Build lockfile from what was actually written
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

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

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
			const baseJson = JSON.parse(stripJsonComments(base)) as Record<
				string,
				unknown
			>;
			const currentJson = JSON.parse(stripJsonComments(current)) as Record<
				string,
				unknown
			>;
			const incomingJson = JSON.parse(stripJsonComments(incoming)) as Record<
				string,
				unknown
			>;

			const { merged, conflicts } = threeWayMergeJson(
				baseJson,
				currentJson,
				incomingJson,
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
		} catch {
			// JSON parse failed — fall through to line-based merge
		}
	}

	const merged = threeWayMergeLines(base, current, incoming);
	return { _tag: "Write", path, content: merged };
}

function stripJsonComments(content: string): string {
	return content.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
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
				// Backup current file before overwriting
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

function findBackupPath(fs: FileSystem.FileSystem, originalPath: string) {
	return Effect.gen(function* () {
		const lastDot = originalPath.lastIndexOf(".");
		const base = lastDot > 0 ? originalPath.slice(0, lastDot) : originalPath;
		const ext = lastDot > 0 ? originalPath.slice(lastDot) : "";

		let n = 1;
		while (true) {
			const candidate = `${base}.old${String(n)}${ext}`;
			const exists = yield* fs.exists(candidate);
			if (!exists) return candidate;
			n++;
		}
	});
}
