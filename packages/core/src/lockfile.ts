import { FileSystem } from "@effect/platform";
import { Effect, Schema } from "effect";
import { ParseError } from "./errors";

const FileRecord = Schema.Struct({
	generators: Schema.Array(Schema.String),
	hash: Schema.String,
});

export const LockfileSchema = Schema.Struct({
	files: Schema.Record({ key: Schema.String, value: FileRecord }),
});

export type Lockfile = typeof LockfileSchema.Type;

const LOCKFILE_DIR = ".forge";
const LOCKFILE_FILE = "forge.lock";

function lockfilePath(projectRoot: string) {
	return `${projectRoot}/${LOCKFILE_DIR}/${LOCKFILE_FILE}`;
}

export function read(projectRoot: string) {
	return Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const path = lockfilePath(projectRoot);
		const exists = yield* fs.exists(path);

		if (!exists) return { files: {} } satisfies Lockfile;

		const raw = yield* fs.readFileString(path);
		const parsed = yield* Effect.try({
			try: () => JSON.parse(raw) as unknown,
			catch: (e) =>
				new ParseError({
					filePath: path,
					message: `Failed to Parse Lockfile: ${String(e)}`,
				}),
		});

		return yield* Schema.decodeUnknown(LockfileSchema)(parsed);
	});
}

export function write(projectRoot: string, lockfile: Lockfile) {
	return Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const dir = `${projectRoot}/${LOCKFILE_DIR}`;

		yield* fs.makeDirectory(dir, { recursive: true });
		yield* fs.writeFileString(
			lockfilePath(projectRoot),
			`${JSON.stringify(lockfile, null, "\t")}\n`,
		);
	});
}
