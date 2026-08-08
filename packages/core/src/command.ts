import { FileSystem } from "@effect/platform";
import { Effect, Either, Option, Schema } from "effect";
import { CommandProbeError } from "./errors";
import {
	PROBE_MAX_OUTPUT_BYTES,
	PROBE_TIMEOUT_MS,
	Subprocess,
} from "./subprocess";

const PersistedPackageJsonSchema = Schema.parseJson(
	Schema.Struct({
		engines: Schema.optional(
			Schema.Record({ key: Schema.String, value: Schema.String }),
		),
		packageManager: Schema.optional(Schema.String),
	}),
);

export class CommandProbe extends Effect.Service<CommandProbe>()(
	"CommandProbe",
	{
		accessors: true,
		effect: Effect.gen(function* () {
			const subprocess = yield* Subprocess;
			const readVersion = Effect.fn("CommandProbe.readVersion")(function* (
				command: string,
			) {
				return yield* subprocess
					.run({
						command,
						args: ["--version"],
						timeoutMs: PROBE_TIMEOUT_MS,
						maxOutputBytes: PROBE_MAX_OUTPUT_BYTES,
						outputMode: "capture",
					})
					.pipe(
						Effect.map((result) => result.output.trim().replace(/^v/, "")),
						Effect.mapError(
							(error) =>
								new CommandProbeError({
									command,
									reason: "probe-failed",
									detail: error.message,
									cause: error,
								}),
						),
					);
			});

			return { readVersion };
		}),
	},
) {}

export const CommandVersionSchema = Schema.String;

export function readPersistedCommandVersions(
	projectRoot: string,
	runtimeCommandName: string,
	packageManagerCommandName: string,
) {
	return Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const packageJsonRaw = yield* fs
			.readFileString(`${projectRoot}/package.json`)
			.pipe(Effect.option);

		const nvmrcRaw = yield* fs
			.readFileString(`${projectRoot}/.nvmrc`)
			.pipe(Effect.option);

		const packageJson = Option.flatMap(packageJsonRaw, (raw) => {
			const decoded = Schema.decodeUnknownEither(PersistedPackageJsonSchema)(
				raw,
			);

			return Either.isRight(decoded)
				? Option.some(decoded.right)
				: Option.none();
		});

		const engines = Option.flatMap(packageJson, (value) =>
			Option.fromNullable(value.engines),
		);

		const runtimeVersion = Option.flatMap(engines, (value) =>
			Option.fromNullable(value[runtimeCommandName]),
		);

		const packageManagerVersion = Option.flatMap(packageJson, (value) => {
			const prefix = `${packageManagerCommandName}@`;
			return value.packageManager?.startsWith(prefix)
				? Option.some(value.packageManager.slice(prefix.length))
				: Option.none();
		});

		const nodeVersion = Option.map(nvmrcRaw, (raw) =>
			raw.trim().replace(/^v/, ""),
		);

		const persisted: Record<string, string> = {};

		if (Option.isSome(runtimeVersion))
			persisted[runtimeCommandName] = runtimeVersion.value;

		if (Option.isSome(packageManagerVersion))
			persisted[packageManagerCommandName] = packageManagerVersion.value;

		if (Option.isSome(nodeVersion) && nodeVersion.value.length > 0)
			persisted.node = nodeVersion.value;

		return persisted;
	});
}
