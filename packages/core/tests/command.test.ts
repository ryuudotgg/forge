import { join } from "node:path";
import { NodeContext } from "@effect/platform-node";
import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";
import { CommandProbe, readPersistedCommandVersions } from "../src/command";
import { withTempDir, writeJson, writeText } from "./harness";

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

async function readPersisted(
	directory: string,
	runtimeCommandName = "bun",
	packageManagerCommandName = "pnpm",
) {
	return Effect.runPromise(
		readPersistedCommandVersions(
			directory,
			runtimeCommandName,
			packageManagerCommandName,
		).pipe(Effect.provide(NodeContext.layer)),
	);
}

describe("readPersistedCommandVersions", () => {
	it("returns an empty record when package.json and .nvmrc are absent", async () => {
		await withTempDir("command-persisted-missing", async (directory) => {
			expect(await readPersisted(directory)).toEqual({});
		});
	});

	it("returns an empty record when package.json fails schema decoding", async () => {
		await withTempDir("command-persisted-invalid", async (directory) => {
			await writeJson(join(directory, "package.json"), { engines: 42 });

			expect(await readPersisted(directory)).toEqual({});
		});
	});

	it("returns an empty record when engines and packageManager are absent", async () => {
		await withTempDir("command-persisted-empty", async (directory) => {
			await writeJson(join(directory, "package.json"), {});

			expect(await readPersisted(directory)).toEqual({});
		});
	});

	it("returns the configured runtime engine as a partial record", async () => {
		await withTempDir("command-persisted-runtime", async (directory) => {
			await writeJson(join(directory, "package.json"), {
				engines: { bun: "1.2.20" },
			});

			expect(await readPersisted(directory)).toEqual({ bun: "1.2.20" });
		});
	});

	it("ignores engines that do not include the configured runtime", async () => {
		await withTempDir("command-persisted-other-runtime", async (directory) => {
			await writeJson(join(directory, "package.json"), {
				engines: { node: ">=22" },
			});

			expect(await readPersisted(directory)).toEqual({});
		});
	});

	it("extracts a matching package manager version as a partial record", async () => {
		await withTempDir("command-persisted-manager", async (directory) => {
			await writeJson(join(directory, "package.json"), {
				packageManager: "pnpm@10.14.0",
			});

			expect(await readPersisted(directory)).toEqual({ pnpm: "10.14.0" });
		});
	});

	it("ignores a package manager with a different prefix", async () => {
		await withTempDir("command-persisted-other-manager", async (directory) => {
			await writeJson(join(directory, "package.json"), {
				packageManager: "npm@11.5.1",
			});

			expect(await readPersisted(directory)).toEqual({});
		});
	});

	it("trims .nvmrc and strips its v prefix as a partial record", async () => {
		await withTempDir("command-persisted-nvmrc", async (directory) => {
			await writeText(join(directory, ".nvmrc"), "  v22.18.0\n");

			expect(await readPersisted(directory)).toEqual({ node: "22.18.0" });
		});
	});

	it("ignores an empty .nvmrc", async () => {
		await withTempDir("command-persisted-empty-nvmrc", async (directory) => {
			await writeText(join(directory, ".nvmrc"), " \n");

			expect(await readPersisted(directory)).toEqual({});
		});
	});

	it("assembles runtime, package manager, and node versions", async () => {
		await withTempDir("command-persisted-full", async (directory) => {
			await writeJson(join(directory, "package.json"), {
				engines: { bun: "1.2.20" },
				packageManager: "pnpm@10.14.0",
			});
			await writeText(join(directory, ".nvmrc"), "v22.18.0\n");

			expect(await readPersisted(directory)).toEqual({
				bun: "1.2.20",
				pnpm: "10.14.0",
				node: "22.18.0",
			});
		});
	});
});
