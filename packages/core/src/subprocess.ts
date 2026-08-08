import {
	Clock,
	Context,
	Effect,
	Layer,
	Option,
	type PlatformError,
	Stream,
} from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";
import { SubprocessError } from "./errors";

export const PROBE_TIMEOUT_MS = 10_000;
export const LONG_RUNNING_TIMEOUT_MS = 600_000;
export const PROBE_MAX_OUTPUT_BYTES = 8_192;

const STDERR_TAIL_BYTES = 2_048;

export type SubprocessOutputMode = "capture" | "pipe";

export interface SubprocessInput {
	readonly command: string;
	readonly args: ReadonlyArray<string>;
	readonly cwd?: string;
	readonly env?: Readonly<Record<string, string | undefined>>;
	readonly timeoutMs: number;
	readonly maxOutputBytes?: number;
	readonly outputMode: SubprocessOutputMode;
}

export interface SubprocessResult {
	readonly exitCode: number;
	readonly output: string;
}

function configureCommand(input: SubprocessInput) {
	return ChildProcess.make(input.command, input.args, {
		...(input.cwd === undefined ? {} : { cwd: input.cwd }),
		...(input.env === undefined ? {} : { env: input.env, extendEnv: true }),
		stdout: "pipe",
		stderr: "pipe",
	});
}

function errorFields(input: SubprocessInput) {
	return {
		command: input.command,
		args: input.args,
		...(input.cwd === undefined ? {} : { cwd: input.cwd }),
	};
}

function platformErrorDetail(cause: PlatformError.PlatformError) {
	const reason = cause.reason;
	if (reason._tag === "BadArgument" || reason.cause === undefined)
		return reason.message;

	const nested = reason.cause;
	if (!(nested instanceof Error)) return `${reason.message}: ${String(nested)}`;

	const code = "code" in nested ? nested.code : undefined;
	const nestedMessage = nested.message;
	const detail =
		typeof code === "string" && !nestedMessage.includes(code)
			? `${code}: ${nestedMessage}`
			: nestedMessage;

	return `${reason.message}: ${detail}`;
}

function collectOutput(
	input: SubprocessInput,
	command: ChildProcess.Command,
	spawner: ChildProcessSpawner.ChildProcessSpawner["Service"],
) {
	return Effect.scoped(
		Effect.gen(function* () {
			const process = yield* spawner.spawn(command);
			const maxOutputBytes = input.maxOutputBytes;
			const decoder = new TextDecoder();

			const collect = Stream.runFoldEffect(
				process.stdout,
				() => ({ bytes: 0, text: "" }),
				(state, chunk) => {
					const bytes = state.bytes + chunk.byteLength;
					if (maxOutputBytes !== undefined && bytes > maxOutputBytes)
						return Effect.fail(
							new SubprocessError({
								...errorFields(input),
								reason: "output-limit-error",
								maxOutputBytes,
							}),
						);

					return Effect.succeed({
						bytes,
						text: state.text + decoder.decode(chunk, { stream: true }),
					});
				},
			).pipe(Effect.map((result) => result.text + decoder.decode()));

			const [output, stderrTail, exitCode] = yield* Effect.all(
				[collect, collectTail(process.stderr), process.exitCode],
				{ concurrency: "unbounded" },
			);

			return { exitCode, output, stderrTail };
		}),
	);
}

function appendTail(tail: Uint8Array, chunk: Uint8Array): Uint8Array {
	if (chunk.byteLength >= STDERR_TAIL_BYTES)
		return chunk.slice(chunk.byteLength - STDERR_TAIL_BYTES);

	const overflow = tail.byteLength + chunk.byteLength - STDERR_TAIL_BYTES;
	const retained = overflow > 0 ? tail.slice(overflow) : tail;
	const combined = new Uint8Array(retained.byteLength + chunk.byteLength);

	combined.set(retained);
	combined.set(chunk, retained.byteLength);

	return combined;
}

function collectTail<Error, Requirements>(
	stream: Stream.Stream<Uint8Array, Error, Requirements>,
) {
	return Stream.runFold(stream, () => new Uint8Array(), appendTail).pipe(
		Effect.map((tail) => new TextDecoder().decode(tail)),
	);
}

function drainOutput(
	command: ChildProcess.Command,
	spawner: ChildProcessSpawner.ChildProcessSpawner["Service"],
) {
	return Effect.scoped(
		Effect.gen(function* () {
			const process = yield* spawner.spawn(command);
			const [, stderrTail, exitCode] = yield* Effect.all(
				[
					Stream.runDrain(process.stdout),
					collectTail(process.stderr),
					process.exitCode,
				],
				{ concurrency: "unbounded" },
			);

			return { exitCode, output: "", stderrTail };
		}),
	);
}

const makeSubprocess = Effect.gen(function* () {
	const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
	const run = Effect.fn("Subprocess.run")(function* (input: SubprocessInput) {
		const command = configureCommand(input);
		const execution =
			input.outputMode === "capture"
				? collectOutput(input, command, spawner)
				: drainOutput(command, spawner);

		const startedAt = yield* Clock.currentTimeMillis;
		const resultOption = yield* execution.pipe(
			Effect.mapError((cause) => {
				if (cause instanceof SubprocessError) return cause;
				const detail = platformErrorDetail(cause);

				return new SubprocessError({
					...errorFields(input),
					reason: "spawn-error",
					detail,
					cause,
				});
			}),
			Effect.timeoutOption(input.timeoutMs),
		);

		if (Option.isNone(resultOption)) {
			const finishedAt = yield* Clock.currentTimeMillis;
			return yield* new SubprocessError({
				...errorFields(input),
				reason: "timeout-error",
				timeoutMs: input.timeoutMs,
				elapsedMs: finishedAt - startedAt,
			});
		}

		const result = resultOption.value;
		if (result.exitCode !== 0)
			return yield* new SubprocessError({
				...errorFields(input),
				reason: "non-zero-exit",
				exitCode: result.exitCode,
				...(result.stderrTail.length === 0
					? {}
					: { detail: result.stderrTail }),
			});

		return { exitCode: Number(result.exitCode), output: result.output };
	});

	return { run };
});

type SubprocessService = Effect.Success<typeof makeSubprocess>;

export class Subprocess extends Context.Service<
	Subprocess,
	SubprocessService
>()("Subprocess") {
	static readonly Default = Layer.effect(Subprocess, makeSubprocess);
	static readonly run = (...args: Parameters<SubprocessService["run"]>) =>
		Subprocess.use((service) => service.run(...args));
}
