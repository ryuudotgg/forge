import {
	Context,
	Effect,
	FileSystem,
	Layer,
	Option,
	Result,
	Schema,
} from "effect";
import { CommandProbeError } from "./errors";
import {
	PROBE_MAX_OUTPUT_BYTES,
	PROBE_TIMEOUT_MS,
	Subprocess,
} from "./subprocess";

const PersistedPackageJsonSchema = Schema.fromJsonString(
	Schema.Struct({
		engines: Schema.optional(Schema.Record(Schema.String, Schema.String)),
		packageManager: Schema.optional(Schema.String),
	}),
);

const makeCommandProbe = Effect.gen(function* () {
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
});

type CommandProbeService = Effect.Success<typeof makeCommandProbe>;

export class CommandProbe extends Context.Service<
	CommandProbe,
	CommandProbeService
>()("CommandProbe") {
	static readonly Default = Layer.effect(CommandProbe, makeCommandProbe);
	static readonly readVersion = (
		...args: Parameters<CommandProbeService["readVersion"]>
	) => CommandProbe.use((service) => service.readVersion(...args));
}

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
			const decoded = Schema.decodeResult(PersistedPackageJsonSchema)(raw);
			return Result.isSuccess(decoded)
				? Option.some(decoded.success)
				: Option.none();
		});

		const engines = Option.flatMap(packageJson, (value) =>
			Option.fromUndefinedOr(value.engines),
		);

		const runtimeVersion = Option.flatMap(engines, (value) =>
			Option.fromUndefinedOr(value[runtimeCommandName]),
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
