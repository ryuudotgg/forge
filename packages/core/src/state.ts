import { join } from "node:path";
import { FileSystem } from "@effect/platform";
import { Effect, Schema } from "effect";
import { ModuleIdSchema } from "./config";
import { StateError } from "./errors";
import { formatJson } from "./format/json";
import { hashContentHex } from "./hash";
import { decodeJsonString } from "./json";

const BASES_DIR = "bases";
const PROJECT_STATE_DIR = ".forge";

const MANIFEST_FILE = "manifest.json";
const LOCKFILE_FILE = "lock.json";
const STATE_BUNDLE_FILE = "state.json";

export const SURFACE_MERGE_SEMANTICS_VERSION = 1;

const StateSchemaVersion = Schema.Literal(1).annotations({
	message: () =>
		"We can't read this project's metadata because it was saved by a different version of Forge.",
});

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
	versions: Schema.optional(
		Schema.Array(
			Schema.Struct({
				name: Schema.String,
				root: Schema.String,
				section: Schema.Literal(
					"dependencies",
					"devDependencies",
					"optionalDependencies",
					"peerDependencies",
				),
				specifier: Schema.String,
				version: Schema.optional(Schema.String),
			}),
		),
	),
});

export type InstallRecord = typeof InstallRecordSchema.Type;

const LockfileArtifactKindSchema = Schema.Literal("file", "surface");
export type LockfileArtifactKind = typeof LockfileArtifactKindSchema.Type;

const SurfaceMergeKindSchema = Schema.Literal("json", "lines", "env");
export type SurfaceMergeKind = typeof SurfaceMergeKindSchema.Type;

const ArtifactMergeKindSchema = Schema.Union(
	SurfaceMergeKindSchema,
	Schema.Literal("opaque"),
);
export type ArtifactMergeKind = typeof ArtifactMergeKindSchema.Type;

const ArtifactBaseSchema = Schema.Struct({
	hash: Schema.String,
	mergeKind: ArtifactMergeKindSchema,
	origin: Schema.optional(Schema.Literal("adopted")),
	semanticsVersion: Schema.Number,
});

export type ArtifactBase = typeof ArtifactBaseSchema.Type;

const LockfileArtifactSchema = Schema.Struct({
	base: Schema.optional(ArtifactBaseSchema),
	kind: LockfileArtifactKindSchema,
	definitionIds: Schema.Array(Schema.String),
	hash: Schema.String,
	path: Schema.String,
});

export type LockfileArtifact = typeof LockfileArtifactSchema.Type;

const RegistryPackageIdSchema = Schema.String.pipe(
	Schema.pattern(/^@[^/\s]+\/[^/\s]+$/),
);

const RegistryUnitSchema = Schema.Union(
	Schema.Struct({ id: Schema.String, kind: Schema.Literal("addon") }),
	Schema.Struct({
		addon: Schema.String,
		framework: Schema.String,
		kind: Schema.Literal("adapter"),
	}),
	Schema.Struct({ id: Schema.String, kind: Schema.Literal("framework") }),
	Schema.Struct({ id: Schema.String, kind: Schema.Literal("template") }),
);

export type RegistryUnit = typeof RegistryUnitSchema.Type;

export const RegistryDescriptorSchema = Schema.Struct({
	apiVersion: Schema.Int,
	id: RegistryPackageIdSchema,
	integrity: Schema.optional(Schema.String),
	source: Schema.Literal("npm"),
	units: Schema.Array(RegistryUnitSchema),
	version: Schema.String,
});

export type RegistryDescriptor = typeof RegistryDescriptorSchema.Type;

export const ManifestSchema = Schema.Struct({
	schemaVersion: Schema.propertySignature(StateSchemaVersion).annotations({
		missingMessage: () =>
			"We can't read this project's metadata because it was saved by a different version of Forge.",
	}),
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
	registries: Schema.optional(Schema.Array(RegistryPackageIdSchema)),
	registryDescriptors: Schema.optional(Schema.Array(RegistryDescriptorSchema)),
});

export type Manifest = typeof ManifestSchema.Type;
export type ManifestInput = Omit<Manifest, "schemaVersion"> & {
	readonly schemaVersion?: number;
};

export const LockfileSchema = Schema.Struct({
	schemaVersion: Schema.propertySignature(StateSchemaVersion).annotations({
		missingMessage: () =>
			"We can't read this project's metadata because it was saved by a different version of Forge.",
	}),
	artifacts: Schema.optionalWith(
		Schema.Record({ key: Schema.String, value: LockfileArtifactSchema }),
		{ default: () => ({}) },
	),
});

export type Lockfile = typeof LockfileSchema.Type;
export type LockfileInput = Omit<Lockfile, "schemaVersion"> & {
	readonly schemaVersion?: number;
};

export const StateBundleSchema = Schema.Struct({
	lockfile: LockfileSchema,
	manifest: ManifestSchema,
});

export type StateBundle = typeof StateBundleSchema.Type;

export function defaultManifest(): Manifest {
	return {
		schemaVersion: 1,
		config: {},
		installs: [],
		modules: {},
	};
}

export function defaultLockfile(): Lockfile {
	return { schemaVersion: 1, artifacts: {} };
}

function manifestPath(projectRoot: string) {
	return join(projectRoot, PROJECT_STATE_DIR, MANIFEST_FILE);
}

function lockfilePath(projectRoot: string) {
	return join(projectRoot, PROJECT_STATE_DIR, LOCKFILE_FILE);
}

function stateBundlePath(projectRoot: string) {
	return join(projectRoot, PROJECT_STATE_DIR, STATE_BUNDLE_FILE);
}

function basesPath(projectRoot: string) {
	return join(projectRoot, PROJECT_STATE_DIR, BASES_DIR);
}

function basePath(projectRoot: string, hash: string) {
	return join(basesPath(projectRoot), hash);
}

function validBaseHash(hash: string): boolean {
	return /^[a-f0-9]{64}$/.test(hash);
}

export interface ArtifactIndex {
	readonly byId: Map<string, LockfileArtifact>;
	readonly byPath: Map<string, LockfileArtifact>;
}

export function buildArtifactIndex(lockfile: Lockfile): ArtifactIndex {
	const byId = new Map<string, LockfileArtifact>();
	const byPath = new Map<string, LockfileArtifact>();

	for (const [id, artifact] of Object.entries(lockfile.artifacts)) {
		byId.set(id, artifact);
		byPath.set(artifact.path, artifact);
	}

	return { byId, byPath };
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

function decodeStateBundle(raw: string, path: string) {
	return decodeJsonString(raw, StateBundleSchema, {
		onParseError: (message) =>
			new StateError({
				filePath: path,
				message: `State Bundle Parse Failed: ${message}`,
			}),
		onValidationError: (issues) =>
			new StateError({
				filePath: path,
				message: `Invalid State Bundle\n${issues
					.map((issue) => `  ${issue}`)
					.join("\n")}`,
			}),
	});
}

export class State extends Effect.Service<State>()("State", {
	accessors: true,
	effect: Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;

		const hashBaseContent = Effect.fn("State.hashBaseContent")(function* (
			content: string,
			path: string,
		) {
			return yield* hashContentHex(
				content,
				() => new StateError({ filePath: path, message: "Base Hash Failed" }),
			);
		});

		const readStateBundle = Effect.fn("State.readStateBundle")(function* (
			projectRoot: string,
		) {
			const path = stateBundlePath(projectRoot);
			if (!(yield* fs.exists(path))) return undefined;

			const raw = yield* fs.readFileString(path).pipe(
				Effect.catchTag(
					"SystemError",
					() =>
						new StateError({
							filePath: path,
							message: "State Bundle Read Failed",
						}),
				),
			);

			return yield* decodeStateBundle(raw, path);
		});

		const readManifest = Effect.fn("State.readManifest")(function* (
			projectRoot: string,
		) {
			const bundle = yield* readStateBundle(projectRoot);
			if (bundle !== undefined) return bundle.manifest;

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
				const path = manifestPath(projectRoot);

				const bundle = yield* readStateBundle(projectRoot);
				if (bundle !== undefined) return bundle.manifest;

				const exists = yield* fs.exists(path);
				if (!exists) return defaultManifest();

				return yield* readManifest(projectRoot);
			},
		);

		const writeManifest = Effect.fn("State.writeManifest")(function* (
			projectRoot: string,
			manifest: ManifestInput,
		) {
			const path = manifestPath(projectRoot);
			const versionedManifest: Manifest = { ...manifest, schemaVersion: 1 };

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
				.writeFileString(
					path,
					formatJson(versionedManifest, { compact: false }),
				)
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
			const bundle = yield* readStateBundle(projectRoot);
			if (bundle !== undefined) return bundle.lockfile;

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
			lockfile: LockfileInput,
		) {
			const path = lockfilePath(projectRoot);
			const versionedLockfile: Lockfile = { ...lockfile, schemaVersion: 1 };

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
				.writeFileString(
					path,
					formatJson(versionedLockfile, { compact: false }),
				)
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

		const readBase = Effect.fn("State.readBase")(function* (
			projectRoot: string,
			hash: string,
		) {
			const path = basePath(projectRoot, hash);
			if (!validBaseHash(hash))
				return yield* new StateError({
					filePath: path,
					message: "Invalid Base Hash",
				});

			const content = yield* fs.readFileString(path).pipe(
				Effect.catchTag(
					"SystemError",
					() =>
						new StateError({
							filePath: path,
							message: "Base Read Failed",
						}),
				),
			);

			if ((yield* hashBaseContent(content, path)) !== hash)
				return yield* new StateError({
					filePath: path,
					message: "Base Hash Mismatch",
				});

			return content;
		});

		const writeBase = Effect.fn("State.writeBase")(function* (
			projectRoot: string,
			hash: string,
			content: string,
		) {
			const path = basePath(projectRoot, hash);
			if (!validBaseHash(hash))
				return yield* new StateError({
					filePath: path,
					message: "Invalid Base Hash",
				});

			if ((yield* hashBaseContent(content, path)) !== hash)
				return yield* new StateError({
					filePath: path,
					message: "Base Hash Mismatch",
				});

			yield* fs.makeDirectory(basesPath(projectRoot), { recursive: true }).pipe(
				Effect.catchTag(
					"SystemError",
					() =>
						new StateError({
							filePath: path,
							message: "Base Directory Failed",
						}),
				),
			);

			const exists = yield* fs.exists(path);
			if (exists) {
				yield* readBase(projectRoot, hash);
				return;
			}

			yield* fs
				.writeFileString(path, content)
				.pipe(
					Effect.catchTag(
						"SystemError",
						() =>
							new StateError({ filePath: path, message: "Base Write Failed" }),
					),
				);
		});

		const garbageCollectBases = Effect.fn("State.garbageCollectBases")(
			function* (projectRoot: string, lockfile: LockfileInput) {
				const directory = basesPath(projectRoot);
				if (!(yield* fs.exists(directory))) return;

				const referenced = new Set(
					Object.values(lockfile.artifacts).flatMap((artifact) =>
						artifact.base === undefined ? [] : [artifact.base.hash],
					),
				);

				const entries = yield* fs.readDirectory(directory).pipe(
					Effect.catchTag(
						"SystemError",
						() =>
							new StateError({
								filePath: directory,
								message: "Base Directory Read Failed",
							}),
					),
				);

				for (const entry of entries) {
					if (referenced.has(entry)) continue;

					const path = basePath(projectRoot, entry);
					yield* fs.remove(path).pipe(
						Effect.catchTag(
							"SystemError",
							() =>
								new StateError({
									filePath: path,
									message: "Base Remove Failed",
								}),
						),
					);
				}
			},
		);

		const isManagedProject = Effect.fn("State.isManagedProject")(function* (
			projectRoot: string,
		) {
			const stateBundleExists = yield* fs.exists(stateBundlePath(projectRoot));
			if (stateBundleExists) return true;

			const lockfileExists = yield* fs.exists(lockfilePath(projectRoot));
			if (lockfileExists) return true;

			return yield* fs.exists(manifestPath(projectRoot));
		});

		return {
			garbageCollectBases,
			isManagedProject,
			readBase,
			readLockfile,
			readManifest,
			readManifestOrDefault,
			readStateBundle,
			writeLockfile,
			writeManifest,
			writeBase,
		};
	}),
}) {}
