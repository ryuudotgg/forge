import { join } from "node:path";
import { FileSystem } from "@effect/platform";
import { Effect, Schema } from "effect";
import { ModuleIdSchema } from "./config";
import { StateError } from "./errors";
import { formatJson } from "./format/json";
import { decodeJsonString } from "./json";

const PROJECT_STATE_DIR = ".forge";
const MANIFEST_FILE = "manifest.json";
const LOCKFILE_FILE = "lock.json";

const ModuleRecordSchema = Schema.Struct({
	root: Schema.optional(Schema.String),
	definitionIds: Schema.optionalWith(Schema.Array(Schema.String), {
		default: () => [],
	}),
});

export type ModuleRecord = typeof ModuleRecordSchema.Type;

const ConfigSnapshotSchema = Schema.Record({
	key: Schema.String,
	value: Schema.Unknown,
});

const InstallTargetSchema = Schema.Union(
	Schema.Struct({ kind: Schema.Literal("project") }),
	Schema.Struct({
		kind: Schema.Literal("module"),
		moduleId: ModuleIdSchema,
	}),
);

export type InstallTarget = typeof InstallTargetSchema.Type;

const InstallRecordSchema = Schema.Struct({
	definitionId: Schema.String,
	targets: Schema.Array(InstallTargetSchema),
});

export type InstallRecord = typeof InstallRecordSchema.Type;

const LockfileArtifactKindSchema = Schema.Literal("file", "surface");
export type LockfileArtifactKind = typeof LockfileArtifactKindSchema.Type;

const LockfileArtifactSchema = Schema.Struct({
	kind: LockfileArtifactKindSchema,
	definitionIds: Schema.Array(Schema.String),
	hash: Schema.String,
	path: Schema.String,
});

export type LockfileArtifact = typeof LockfileArtifactSchema.Type;

export const ManifestSchema = Schema.Struct({
	config: Schema.optionalWith(ConfigSnapshotSchema, {
		default: () => ({}),
	}),
	modules: Schema.Record({
		key: ModuleIdSchema,
		value: ModuleRecordSchema,
	}),
	installs: Schema.optionalWith(Schema.Array(InstallRecordSchema), {
		default: () => [],
	}),
});

export type Manifest = typeof ManifestSchema.Type;

export const LockfileSchema = Schema.Struct({
	artifacts: Schema.optionalWith(
		Schema.Record({ key: Schema.String, value: LockfileArtifactSchema }),
		{ default: () => ({}) },
	),
});

export type Lockfile = typeof LockfileSchema.Type;

export function defaultManifest(): Manifest {
	return {
		config: {},
		installs: [],
		modules: {},
	};
}

export function defaultLockfile(): Lockfile {
	return { artifacts: {} };
}

function manifestPath(projectRoot: string) {
	return join(projectRoot, PROJECT_STATE_DIR, MANIFEST_FILE);
}

function lockfilePath(projectRoot: string) {
	return join(projectRoot, PROJECT_STATE_DIR, LOCKFILE_FILE);
}

export interface ArtifactIndex {
	readonly byDefinition: Map<string, ReadonlyArray<LockfileArtifact>>;
	readonly byId: Map<string, LockfileArtifact>;
	readonly byPath: Map<string, LockfileArtifact>;
}

export function buildArtifactIndex(lockfile: Lockfile): ArtifactIndex {
	const byDefinition = new Map<string, LockfileArtifact[]>();
	const byId = new Map<string, LockfileArtifact>();
	const byPath = new Map<string, LockfileArtifact>();

	for (const [id, artifact] of Object.entries(lockfile.artifacts)) {
		byId.set(id, artifact);
		byPath.set(artifact.path, artifact);

		for (const definitionId of artifact.definitionIds) {
			const artifacts = byDefinition.get(definitionId) ?? [];
			artifacts.push(artifact);
			byDefinition.set(definitionId, artifacts);
		}
	}

	return { byDefinition, byId, byPath };
}

function decodeManifest(raw: string, path: string) {
	return decodeJsonString(raw, ManifestSchema, {
		onParseError: (message) =>
			new StateError({
				filePath: path,
				message: `Manifest Parse Failed: ${message}`,
			}),
		onValidationError: (issues) =>
			new StateError({
				filePath: path,
				message: `Invalid Manifest\n${issues
					.map((issue) => `  ${issue}`)
					.join("\n")}`,
			}),
	});
}

function decodeLockfile(raw: string, path: string) {
	return decodeJsonString(raw, LockfileSchema, {
		onParseError: (message) =>
			new StateError({
				filePath: path,
				message: `Lockfile Parse Failed: ${message}`,
			}),
		onValidationError: (issues) =>
			new StateError({
				filePath: path,
				message: `Invalid Lockfile\n${issues
					.map((issue) => `  ${issue}`)
					.join("\n")}`,
			}),
	});
}

export class State extends Effect.Service<State>()("State", {
	accessors: true,
	effect: Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;

		const readManifest = Effect.fn("State.readManifest")(function* (
			projectRoot: string,
		) {
			const path = manifestPath(projectRoot);
			const exists = yield* fs.exists(path);

			if (!exists)
				return yield* new StateError({
					filePath: path,
					message: "Manifest Not Found",
				});

			const raw = yield* fs.readFileString(path).pipe(
				Effect.catchTag(
					"SystemError",
					() =>
						new StateError({
							filePath: path,
							message: "Manifest Read Failed",
						}),
				),
			);

			return yield* decodeManifest(raw, path);
		});

		const readManifestOrDefault = Effect.fn("State.readManifestOrDefault")(
			function* (projectRoot: string) {
				return yield* readManifest(projectRoot).pipe(
					Effect.catchTag("StateError", () =>
						Effect.succeed(defaultManifest()),
					),
				);
			},
		);

		const writeManifest = Effect.fn("State.writeManifest")(function* (
			projectRoot: string,
			manifest: Manifest,
		) {
			const path = manifestPath(projectRoot);

			yield* fs
				.makeDirectory(join(projectRoot, PROJECT_STATE_DIR), {
					recursive: true,
				})
				.pipe(
					Effect.catchTag(
						"SystemError",
						() =>
							new StateError({
								filePath: path,
								message: "Manifest Directory Failed",
							}),
					),
				);

			yield* fs
				.writeFileString(path, formatJson(manifest, { compact: false }))
				.pipe(
					Effect.catchTag(
						"SystemError",
						() =>
							new StateError({
								filePath: path,
								message: "Manifest Write Failed",
							}),
					),
				);
		});

		const readLockfile = Effect.fn("State.readLockfile")(function* (
			projectRoot: string,
		) {
			const path = lockfilePath(projectRoot);
			const exists = yield* fs.exists(path);

			if (!exists) return defaultLockfile();

			const raw = yield* fs.readFileString(path).pipe(
				Effect.catchTag(
					"SystemError",
					() =>
						new StateError({
							filePath: path,
							message: "Lockfile Read Failed",
						}),
				),
			);

			return yield* decodeLockfile(raw, path);
		});

		const writeLockfile = Effect.fn("State.writeLockfile")(function* (
			projectRoot: string,
			lockfile: Lockfile,
		) {
			const path = lockfilePath(projectRoot);

			yield* fs
				.makeDirectory(join(projectRoot, PROJECT_STATE_DIR), {
					recursive: true,
				})
				.pipe(
					Effect.catchTag(
						"SystemError",
						() =>
							new StateError({
								filePath: path,
								message: "Lockfile Directory Failed",
							}),
					),
				);

			yield* fs
				.writeFileString(path, formatJson(lockfile, { compact: false }))
				.pipe(
					Effect.catchTag(
						"SystemError",
						() =>
							new StateError({
								filePath: path,
								message: "Lockfile Write Failed",
							}),
					),
				);
		});

		const isManagedProject = Effect.fn("State.isManagedProject")(function* (
			projectRoot: string,
		) {
			return yield* fs.exists(manifestPath(projectRoot));
		});

		return {
			isManagedProject,
			readLockfile,
			readManifest,
			readManifestOrDefault,
			writeLockfile,
			writeManifest,
		};
	}),
}) {}
