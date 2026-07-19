import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";
import { CommandProbe } from "../src/command";

vi.mock("node:child_process", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:child_process")>();
	return {
		...actual,
		execFileSync: (...args: Parameters<typeof actual.execFileSync>) => {
			if (args[0] === "forge-test-non-error-4242") {
				throw "plain failure string";
			}
			return actual.execFileSync(...args);
		},
	};
});

describe("CommandProbe", () => {
	it("maps a missing binary to a CommandProbeError", async () => {
		const error = await Effect.runPromise(
			CommandProbe.readVersion("forge-test-missing-binary-4242").pipe(
				Effect.flip,
				Effect.provide(CommandProbe.Default),
			),
		);

		expect(error._tag).toBe("CommandProbeError");
		expect(error.command).toBe("forge-test-missing-binary-4242");
		expect(error.message).toContain("Command Probe Failed");
		expect(error.detail.length).toBeGreaterThan(0);
	});

	it("maps a non-Error failure to a CommandProbeError", async () => {
		const error = await Effect.runPromise(
			CommandProbe.readVersion("forge-test-non-error-4242").pipe(
				Effect.flip,
				Effect.provide(CommandProbe.Default),
			),
		);

		expect(error._tag).toBe("CommandProbeError");
		expect(error.command).toBe("forge-test-non-error-4242");
		expect(error.detail).toBe("plain failure string");
	});
});
