import { Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";
import {
	CommandProbe,
	CommandProbeError,
	checkPackageManager,
	checkRuntime,
	defaultDependencyFormat,
	dependencyFormatFor,
	Environment,
	runtimeCommand,
} from "../src/index";

function probeLayer(versions: Record<string, string>, probed: string[]) {
	return Layer.succeed(
		CommandProbe,
		CommandProbe.make({
			readVersion: (command: string) =>
				Effect.sync(() => {
					probed.push(command);
					return versions[command] ?? "1.0.0";
				}),
		}),
	);
}

const successfulProbeLayer = probeLayer({ pnpm: "10.4.0" }, []);

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

		expect(result).toEqual({
			ok: true,
			message: `Node.js v${process.versions.node}`,
		});
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

	it("probes the command mapped from the display name", async () => {
		const probed: string[] = [];

		const yarn = await Effect.runPromise(
			Environment.checkPackageManager("Yarn").pipe(
				Effect.provide(
					Layer.mergeAll(
						probeLayer({ yarn: "4.9.1", bun: "1.2.0" }, probed),
						Environment.Default,
					),
				),
			),
		);

		const bun = await Effect.runPromise(
			Environment.checkPackageManager("Bun").pipe(
				Effect.provide(
					Layer.mergeAll(
						probeLayer({ yarn: "4.9.1", bun: "1.2.0" }, probed),
						Environment.Default,
					),
				),
			),
		);

		expect(probed).toEqual(["yarn", "bun"]);
		expect(yarn).toEqual({ ok: true, message: "Yarn v4.9.1" });
		expect(bun).toEqual({ ok: true, message: "Bun v1.2.0" });
	});

	it("rejects package manager versions below the minimum major", async () => {
		const result = await Effect.runPromise(
			Environment.checkPackageManager("pnpm").pipe(
				Effect.provide(
					Layer.mergeAll(
						probeLayer({ pnpm: "9.0.0" }, []),
						Environment.Default,
					),
				),
			),
		);

		expect(result).toEqual({
			ok: false,
			message:
				"You need pnpm v10 or later to forge a project, but you're running v9.0.0.",
		});
	});

	it("accepts a package manager version at exactly the minimum major", async () => {
		const result = await Effect.runPromise(
			Environment.checkPackageManager("pnpm").pipe(
				Effect.provide(
					Layer.mergeAll(
						probeLayer({ pnpm: "10.0.0" }, []),
						Environment.Default,
					),
				),
			),
		);

		expect(result).toEqual({ ok: true, message: "pnpm v10.0.0" });
	});

	it("rejects version output it can't parse", async () => {
		for (const garbage of ["unexpected output", "", "v.1.2", "10a.0.0"]) {
			const result = await Effect.runPromise(
				Environment.checkPackageManager("pnpm").pipe(
					Effect.provide(
						Layer.mergeAll(
							probeLayer({ pnpm: garbage }, []),
							Environment.Default,
						),
					),
				),
			);

			expect(result).toEqual({
				ok: false,
				message: "We couldn't tell which pnpm version you're running.",
			});
		}
	});

	it("accepts a bare major version", async () => {
		const result = await Effect.runPromise(
			Environment.checkPackageManager("pnpm").pipe(
				Effect.provide(
					Layer.mergeAll(probeLayer({ pnpm: "10" }, []), Environment.Default),
				),
			),
		);

		expect(result).toEqual({ ok: true, message: "pnpm v10" });
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

	it("reads the raw package manager version through the probe", async () => {
		const version = await Effect.runPromise(
			Environment.readPackageManagerVersion("pnpm").pipe(
				Effect.provide(
					Layer.mergeAll(successfulProbeLayer, Environment.Default),
				),
			),
		);

		expect(version).toBe("10.4.0");
	});

	it("maps runtime display names to commands", () => {
		expect(runtimeCommand("Node.js")).toBe("node");
		expect(runtimeCommand("Bun")).toBe("bun");
		expect(runtimeCommand("Deno")).toBe("deno");
	});

	it("derives the dependency format from the package manager", () => {
		expect(dependencyFormatFor("npm")).toEqual({
			useCatalog: false,
			useWorkspaceProtocol: false,
		});

		expect(dependencyFormatFor("pnpm")).toEqual({
			useCatalog: true,
			useWorkspaceProtocol: true,
		});

		expect(dependencyFormatFor("Yarn")).toEqual({
			useCatalog: false,
			useWorkspaceProtocol: true,
		});

		expect(dependencyFormatFor("Bun")).toEqual({
			useCatalog: false,
			useWorkspaceProtocol: true,
		});

		expect(dependencyFormatFor("not-a-pm")).toEqual(defaultDependencyFormat);
		expect(dependencyFormatFor(undefined)).toEqual(defaultDependencyFormat);
	});

	it("preserves the sync compatibility wrappers", () => {
		const layer = Layer.mergeAll(CommandProbe.Default, Environment.Default);

		const runtime = Effect.runSync(
			Environment.checkRuntime().pipe(Effect.provide(layer)),
		);

		const packageManager = Effect.runSync(
			Environment.checkPackageManager("pnpm").pipe(Effect.provide(layer)),
		);

		expect(checkRuntime()).toEqual(runtime);
		expect(checkRuntime().ok).toBe(true);
		expect(checkPackageManager("pnpm")).toEqual(packageManager);
	});
});
