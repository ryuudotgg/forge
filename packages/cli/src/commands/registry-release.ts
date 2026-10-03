import {
	type PackageManager,
	PROBE_TIMEOUT_MS,
	packageManagerViewCommand,
	Subprocess,
} from "@ryuugg/core";
import { Effect, Option, Schema } from "effect";
import { runCliEffectValue } from "../runtime";

const MAX_RELEASE_OUTPUT_BYTES = 1_048_576;

const LatestReleaseSchema = Schema.fromJsonString(
	Schema.Struct({
		"_npmUser.name": Schema.optional(Schema.String),
		_npmUser: Schema.optional(Schema.Struct({ name: Schema.String })),
		version: Schema.String,
	}),
);

export interface RegistryRelease {
	readonly publisher: string | undefined;
	readonly version: string;
}

export function lookupRegistryRelease(
	projectRoot: string,
	packageManager: PackageManager,
	packageId: string,
): Effect.Effect<Option.Option<RegistryRelease>, never, Subprocess> {
	const operation = packageManagerViewCommand(packageManager, packageId);

	return Subprocess.run({
		...operation,
		cwd: projectRoot,
		maxOutputBytes: MAX_RELEASE_OUTPUT_BYTES,
		outputMode: "capture",
		timeoutMs: PROBE_TIMEOUT_MS,
	}).pipe(
		Effect.flatMap(({ output }) =>
			Schema.decodeEffect(LatestReleaseSchema)(output),
		),
		Effect.map(
			(release): RegistryRelease => ({
				publisher: release["_npmUser.name"] ?? release._npmUser?.name,
				version: release.version,
			}),
		),
		Effect.option,
	);
}

export async function resolveRegistryRelease(
	projectRoot: string,
	packageManager: PackageManager,
	packageId: string,
) {
	return Option.getOrUndefined(
		await runCliEffectValue(
			lookupRegistryRelease(projectRoot, packageManager, packageId),
		),
	);
}
