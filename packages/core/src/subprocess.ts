import { Command, CommandExecutor } from "@effect/platform";
import { Clock, Effect, Option, Stream } from "effect";
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
	let command = Command.make(input.command, ...input.args);
	if (input.cwd !== undefined)
		command = command.pipe(Command.workingDirectory(input.cwd));

	if (input.env !== undefined) command = command.pipe(Command.env(input.env));

	return command.pipe(Command.stdout("pipe"), Command.stderr("pipe"));
}

function errorFields(input: SubprocessInput) {
	return {
		command: input.command,
		args: input.args,
		...(input.cwd === undefined ? {} : { cwd: input.cwd }),
	};
}

function collectOutput(
	input: SubprocessInput,
	command: Command.Command,
	executor: CommandExecutor.CommandExecutor,
) {
	return Effect.scoped(
		Effect.gen(function* () {
			const process = yield* executor.start(command);
			const maxOutputBytes = input.maxOutputBytes;
			const decoder = new TextDecoder();

			const collect = Stream.runFoldEffect(
				process.stdout,
				{ bytes: 0, text: "" },
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
	return Stream.runFold(stream, new Uint8Array(), appendTail).pipe(
		Effect.map((tail) => new TextDecoder().decode(tail)),
	);
}

function drainOutput(
	command: Command.Command,
	executor: CommandExecutor.CommandExecutor,
) {
	return Effect.scoped(
		Effect.gen(function* () {
			const process = yield* executor.start(command);
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

export class Subprocess extends Effect.Service<Subprocess>()("Subprocess", {
	accessors: true,
	effect: Effect.gen(function* () {
		const executor = yield* CommandExecutor.CommandExecutor;
		const run = Effect.fn("Subprocess.run")(function* (input: SubprocessInput) {
			const command = configureCommand(input);
			const execution =
				input.outputMode === "capture"
					? collectOutput(input, command, executor)
					: drainOutput(command, executor);

			const startedAt = yield* Clock.currentTimeMillis;
			const resultOption = yield* execution.pipe(
				Effect.catchTags({
					BadArgument: (cause) =>
						Effect.fail(
							new SubprocessError({
								...errorFields(input),
								reason: "spawn-error",
								detail: cause.message,
								cause,
							}),
						),
					SystemError: (cause) =>
						Effect.fail(
							new SubprocessError({
								...errorFields(input),
								reason: "spawn-error",
								detail: cause.message,
								cause,
							}),
						),
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
	}),
}) {}
