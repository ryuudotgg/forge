import { join } from "node:path";
import { FileSystem } from "@effect/platform";
import { Effect, Schema } from "effect";
import { ArrayFormatter } from "effect/ParseResult";
import { ModuleIdSchema } from "./config";
import { ParseError, StateError } from "./errors";
import { formatJson } from "./format/json";

const PROJECT_STATE_DIR = ".forge";
const MANIFEST_FILE = "manifest.json";
const LOCKFILE_FILE = "lock.json";
const PROJECT_STATE_VERSION = 1;

const InstallRecordSchema = Schema.Struct({
	addonId: Schema.String,
	moduleIds: Schema.Array(ModuleIdSchema),
});

const EmptyModuleRecordSchema = Schema.Struct({});

export const ManifestSchema = Schema.Struct({
	version: Schema.Literal(PROJECT_STATE_VERSION),
	modules: Schema.Record({
		key: ModuleIdSchema,
		value: EmptyModuleRecordSchema,
	}),
	installs: Schema.optionalWith(Schema.Array(InstallRecordSchema), {
		default: () => [],
	}),
});

export type Manifest = typeof ManifestSchema.Type;

export const LockfileSchema = Schema.Struct({
	version: Schema.Literal(PROJECT_STATE_VERSION),
	resolutions: Schema.optionalWith(
		Schema.Record({ key: Schema.String, value: Schema.String }),
		{ default: () => ({}) },
	),
	provenance: Schema.optionalWith(
		Schema.Record({
			key: ModuleIdSchema,
			value: Schema.Array(Schema.String),
		}),
		{ default: () => ({}) },
	),
});

export type Lockfile = typeof LockfileSchema.Type;

function manifestPath(projectRoot: string) {
	return join(projectRoot, PROJECT_STATE_DIR, MANIFEST_FILE);
}

function lockfilePath(projectRoot: string) {
	return join(projectRoot, PROJECT_STATE_DIR, LOCKFILE_FILE);
}

function formatSchemaIssues(
	issues: Parameters<typeof ArrayFormatter.formatErrorSync>[0],
) {
	return ArrayFormatter.formatErrorSync(issues).map((issue) =>
		issue.path.length > 0
			? `${issue.path.join(".")}: ${issue.message}`
			: issue.message,
	);
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

			const raw = yield* fs.readFileString(path);
			const parsed = yield* Effect.try({
				try: () => JSON.parse(raw) as unknown,
				catch: (error) =>
					new ParseError({
						filePath: path,
						message: `Manifest Parse Failed: ${String(error)}`,
					}),
			});

			return yield* Schema.decodeUnknown(ManifestSchema)(parsed).pipe(
				Effect.mapError(
					(issues) =>
						new StateError({
							filePath: path,
							message: `Invalid Manifest\n${formatSchemaIssues(issues)
								.map((issue) => `  ${issue}`)
								.join("\n")}`,
						}),
				),
			);
		});

		const writeManifest = Effect.fn("State.writeManifest")(function* (
			projectRoot: string,
			manifest: Manifest,
		) {
			const path = manifestPath(projectRoot);

			yield* fs.makeDirectory(join(projectRoot, PROJECT_STATE_DIR), {
				recursive: true,
			});

			yield* fs.writeFileString(path, formatJson(manifest, { compact: false }));
		});

		const readLockfile = Effect.fn("State.readLockfile")(function* (
			projectRoot: string,
		) {
			const path = lockfilePath(projectRoot);
			const exists = yield* fs.exists(path);

			if (!exists)
				return {
					version: PROJECT_STATE_VERSION,
					resolutions: {},
					provenance: {},
				} satisfies Lockfile;

			const raw = yield* fs.readFileString(path);
			const parsed = yield* Effect.try({
				try: () => JSON.parse(raw) as unknown,
				catch: (error) =>
					new ParseError({
						filePath: path,
						message: `Lockfile Parse Failed: ${String(error)}`,
					}),
			});

			return yield* Schema.decodeUnknown(LockfileSchema)(parsed).pipe(
				Effect.mapError(
					(issues) =>
						new StateError({
							filePath: path,
							message: `Invalid Lockfile\n${formatSchemaIssues(issues)
								.map((issue) => `  ${issue}`)
								.join("\n")}`,
						}),
				),
			);
		});

		const writeLockfile = Effect.fn("State.writeLockfile")(function* (
			projectRoot: string,
			lockfile: Lockfile,
		) {
			const path = lockfilePath(projectRoot);

			yield* fs.makeDirectory(join(projectRoot, PROJECT_STATE_DIR), {
				recursive: true,
			});

			yield* fs.writeFileString(path, formatJson(lockfile, { compact: false }));
		});

		const isManagedProject = Effect.fn("State.isManagedProject")(function* (
			projectRoot: string,
		) {
			const lockExists = yield* fs.exists(lockfilePath(projectRoot));
			if (lockExists) return true;

			const manifestExists = yield* fs.exists(manifestPath(projectRoot));
			if (!manifestExists) return false;

			const raw = yield* fs.readFileString(manifestPath(projectRoot));
			const parsed = yield* Effect.try({
				try: () => JSON.parse(raw) as unknown,
				catch: () => null,
			});

			if (parsed === null) return false;

			return yield* Schema.decodeUnknown(ManifestSchema)(parsed).pipe(
				Effect.as(true),
				Effect.catchAll(() => Effect.succeed(false)),
			);
		});

		return {
			isManagedProject,
			readLockfile,
			readManifest,
			writeLockfile,
			writeManifest,
		};
	}),
}) {}
