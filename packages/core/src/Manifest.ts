import { FileSystem } from "@effect/platform";
import { Effect, Schema } from "effect";
import { ManifestNotFoundError } from "./Errors";

const GeneratorRecord = Schema.Struct({
	id: Schema.String,
	version: Schema.String,
});

export const ManifestSchema = Schema.Struct({
	version: Schema.Literal(1),
	config: Schema.Record({ key: Schema.String, value: Schema.Unknown }),
	generators: Schema.Array(GeneratorRecord),
	commitRef: Schema.NullOr(Schema.String),
});

export type Manifest = typeof ManifestSchema.Type;

const MANIFEST_DIR = ".forge";
const MANIFEST_FILE = "manifest.json";

function manifestPath(projectRoot: string) {
	return `${projectRoot}/${MANIFEST_DIR}/${MANIFEST_FILE}`;
}

export function read(projectRoot: string) {
	return Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const path = manifestPath(projectRoot);
		const exists = yield* fs.exists(path);

		if (!exists)
			return yield* new ManifestNotFoundError({
				projectRoot,
				message: `No manifest found at ${path}`,
			});

		const raw = yield* fs.readFileString(path);
		return yield* Schema.decodeUnknown(ManifestSchema)(JSON.parse(raw));
	});
}

export function write(projectRoot: string, manifest: Manifest) {
	return Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const dir = `${projectRoot}/${MANIFEST_DIR}`;

		yield* fs.makeDirectory(dir, { recursive: true });
		yield* fs.writeFileString(
			manifestPath(projectRoot),
			`${JSON.stringify(manifest, null, "\t")}\n`,
		);
	});
}
