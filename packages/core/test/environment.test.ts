import { Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";
import {
	CommandProbe,
	CommandProbeError,
	checkPackageManager,
	checkRuntime,
	Environment,
} from "../src/index";

const successfulProbeLayer = Layer.succeed(
	CommandProbe,
	CommandProbe.make({
		readVersion: (command: string) =>
			Effect.succeed(command === "pnpm" ? "10.4.0" : "1.0.0"),
	}),
);

const failingProbeLayer = Layer.succeed(
	CommandProbe,
	CommandProbe.make({
		readVersion: (command: string) =>
			Effect.fail(
				new CommandProbeError({
					command,
					message: "Command Probe Failed",
					detail: "missing",
				}),
			),
	}),
);

describe("environment", () => {
	it("checks the current runtime through the service", async () => {
		const result = await Effect.runPromise(
			Environment.checkRuntime().pipe(
				Effect.provide(
					Layer.mergeAll(CommandProbe.Default, Environment.Default),
				),
			),
		);

		expect(result.ok).toBeTypeOf("boolean");
		expect(result.message.length).toBeGreaterThan(0);
	});

	it("checks package managers through an injectable command probe", async () => {
		const result = await Effect.runPromise(
			Environment.checkPackageManager("pnpm").pipe(
				Effect.provide(
					Layer.mergeAll(successfulProbeLayer, Environment.Default),
				),
			),
		);

		expect(result).toEqual({
			ok: true,
			message: "pnpm v10.4.0",
		});
	});

	it("returns a friendly missing-package-manager result on probe failure", async () => {
		const result = await Effect.runPromise(
			Environment.checkPackageManager("Bun").pipe(
				Effect.provide(Layer.mergeAll(failingProbeLayer, Environment.Default)),
			),
		);

		expect(result).toEqual({
			ok: false,
			message: "You don't have Bun installed, please install it and try again.",
		});
	});

	it("preserves the sync compatibility wrappers", () => {
		expect(checkRuntime().message.length).toBeGreaterThan(0);
		expect(checkPackageManager("pnpm").ok).toBeTypeOf("boolean");
	});
});
