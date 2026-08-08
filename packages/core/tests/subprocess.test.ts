import { realpath } from "node:fs/promises";
import { NodeContext } from "@effect/platform-node";
import { Cause, Effect, Exit, Layer, Option } from "effect";
import { describe, expect, it } from "vitest";
import {
	PROBE_MAX_OUTPUT_BYTES,
	PROBE_TIMEOUT_MS,
	Subprocess,
	type SubprocessInput,
} from "../src/index";
import { withTempDir } from "./harness";

const subprocessLayer = Subprocess.Default.pipe(
	Layer.provide(NodeContext.layer),
);

function run(input: SubprocessInput) {
	return Effect.runPromise(
		Subprocess.run(input).pipe(Effect.provide(subprocessLayer)),
	);
}

async function failure(input: SubprocessInput) {
	const exit = await Effect.runPromiseExit(
		Subprocess.run(input).pipe(Effect.provide(subprocessLayer)),
	);
	if (!Exit.isFailure(exit)) throw new Error("Expected Subprocess Failure");

	const error = Cause.failureOption(exit.cause);
	if (Option.isNone(error))
		throw new Error("Expected Typed Subprocess Failure");

	return error.value;
}

describe("Subprocess", () => {
	it("captures output with cwd and environment configuration", async () => {
		await withTempDir("subprocess-capture", async (directory) => {
			const canonicalDirectory = await realpath(directory);
			const result = await run({
				command: process.execPath,
				args: [
					"-e",
					"process.stdout.write(process.cwd() + '|' + process.env.FORGE_SUBPROCESS_TEST)",
				],
				cwd: directory,
				env: { FORGE_SUBPROCESS_TEST: "configured" },
				timeoutMs: PROBE_TIMEOUT_MS,
				maxOutputBytes: PROBE_MAX_OUTPUT_BYTES,
				outputMode: "capture",
			});

			expect(result).toEqual({
				exitCode: 0,
				output: `${canonicalDirectory}|configured`,
			});
		});
	});

	it("returns no buffered output in pipe mode", async () => {
		const result = await run({
			command: process.execPath,
			args: ["-e", "process.exit(0)"],
			timeoutMs: PROBE_TIMEOUT_MS,
			outputMode: "pipe",
		});

		expect(result).toEqual({ exitCode: 0, output: "" });
	});

	it("drains chatty pipe-mode output without stalling", async () => {
		const result = await run({
			command: process.execPath,
			args: [
				"-e",
				'require("node:fs").writeSync(1, Buffer.alloc(2 * 1024 * 1024, 120))',
			],
			timeoutMs: 2_000,
			outputMode: "pipe",
		});

		expect(result).toEqual({ exitCode: 0, output: "" });
	});

	it("maps a missing executable to a spawn error with its cause", async () => {
		const error = await failure({
			command: "forge-test-missing-subprocess-4242",
			args: ["--version"],
			timeoutMs: PROBE_TIMEOUT_MS,
			outputMode: "capture",
		});

		expect(error.reason).toBe("spawn-error");
		expect(error.cause).toBeDefined();
		expect(error.message).toContain(
			"Subprocess Spawn Error: forge-test-missing-subprocess-4242 --version.",
		);
	});

	it("fails a synthetic sleeping command through the typed timeout path", async () => {
		const error = await failure({
			command: process.execPath,
			args: ["-e", "setTimeout(() => {}, 10_000)"],
			timeoutMs: 25,
			outputMode: "capture",
		});

		expect(error.reason).toBe("timeout-error");
		expect(error.timeoutMs).toBe(25);
		expect(error.elapsedMs).toBeGreaterThanOrEqual(20);
		expect(error.message).toContain(`exceeded ${error.elapsedMs ?? 0}ms`);
	});

	it("fails while streaming when captured output exceeds its byte cap", async () => {
		const error = await failure({
			command: process.execPath,
			args: ["-e", 'process.stdout.write("x".repeat(128))'],
			timeoutMs: PROBE_TIMEOUT_MS,
			maxOutputBytes: 16,
			outputMode: "capture",
		});

		expect(error.reason).toBe("output-limit-error");
		expect(error.maxOutputBytes).toBe(16);
		expect(error.message).toContain("exceeded 16 bytes");
	});

	it("maps non-zero exit codes to a typed failure", async () => {
		const error = await failure({
			command: process.execPath,
			args: ["-e", "process.exit(7)"],
			timeoutMs: PROBE_TIMEOUT_MS,
			outputMode: "pipe",
		});

		expect(error.reason).toBe("non-zero-exit");
		expect(error.exitCode).toBe(7);
		expect(error.message).toContain("exited with code 7");
	});

	it.each<SubprocessInput["outputMode"]>(["capture", "pipe"])(
		"adds a bounded stderr tail to %s-mode non-zero failures",
		async (outputMode) => {
			const error = await failure({
				command: process.execPath,
				args: [
					"-e",
					'process.stderr.write("x".repeat(3_000) + "tail-marker"); process.exit(9)',
				],
				timeoutMs: PROBE_TIMEOUT_MS,
				outputMode,
			});

			expect(error.reason).toBe("non-zero-exit");
			expect(error.detail).toBeDefined();
			expect(Buffer.byteLength(error.detail ?? "")).toBeLessThanOrEqual(2_048);
			expect(error.detail).toMatch(/x+tail-marker$/);
			expect(error.message).toBe(
				`Subprocess Non-Zero Exit: ${process.execPath} -e process.stderr.write("x".repeat(3_000) + "tail-marker"); process.exit(9) exited with code 9. ${error.detail ?? ""}`,
			);
		},
	);
});
