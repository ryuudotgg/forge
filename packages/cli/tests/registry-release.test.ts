import { join } from "node:path";
import { describe, expect, it } from "@effect/vitest";
import {
	Subprocess,
	SubprocessError,
	type SubprocessInput,
} from "@ryuugg/core";
import { Effect, Layer, Option } from "effect";
import {
	lookupRegistryRelease,
	resolveRegistryRelease,
} from "../src/commands/registry-release";

function subprocessReturning(
	respond: (input: SubprocessInput) => Effect.Effect<string, SubprocessError>,
) {
	const calls: SubprocessInput[] = [];
	const layer = Layer.succeed(
		Subprocess,
		Subprocess.of({
			run: (input) => {
				calls.push(input);
				return respond(input).pipe(
					Effect.map((output) => ({ exitCode: 0, output })),
				);
			},
		}),
	);

	return { calls, layer };
}

describe("registry release lookup", () => {
	it.effect("asks the project's package manager for the latest release", () =>
		Effect.gen(function* () {
			const { calls, layer } = subprocessReturning(() =>
				Effect.succeed(
					JSON.stringify({ "_npmUser.name": "acme-bot", version: "2.3.4" }),
				),
			);

			const release = yield* lookupRegistryRelease(
				"/project",
				"pnpm",
				"@acme/forge-sentry",
			).pipe(Effect.provide(layer));

			expect(calls).toEqual([
				expect.objectContaining({
					args: [
						"view",
						"@acme/forge-sentry@latest",
						"version",
						"_npmUser.name",
						"--json",
					],
					command: "pnpm",
					cwd: "/project",
					outputMode: "capture",
				}),
			]);
			expect(release).toEqual(
				Option.some({ publisher: "acme-bot", version: "2.3.4" }),
			);
		}),
	);

	it.effect("reads a nested publisher from a full manifest", () =>
		Effect.gen(function* () {
			const { layer } = subprocessReturning(() =>
				Effect.succeed(
					JSON.stringify({
						_npmUser: { email: "bot@acme.dev", name: "acme-bot" },
						name: "@acme/forge-sentry",
						version: "2.3.4",
					}),
				),
			);

			const release = yield* lookupRegistryRelease(
				"/project",
				"Bun",
				"@acme/forge-sentry",
			).pipe(Effect.provide(layer));

			expect(release).toEqual(
				Option.some({ publisher: "acme-bot", version: "2.3.4" }),
			);
		}),
	);

	it.effect("leaves the publisher unknown when the registry records none", () =>
		Effect.gen(function* () {
			const { layer } = subprocessReturning(() =>
				Effect.succeed(JSON.stringify({ version: "2.3.4" })),
			);

			const release = yield* lookupRegistryRelease(
				"/project",
				"npm",
				"@acme/forge-sentry",
			).pipe(Effect.provide(layer));

			expect(release).toEqual(
				Option.some({ publisher: undefined, version: "2.3.4" }),
			);
		}),
	);

	it.effect("returns nothing when the package manager fails", () =>
		Effect.gen(function* () {
			const { layer } = subprocessReturning((input) =>
				Effect.fail(
					new SubprocessError({
						args: input.args,
						command: input.command,
						exitCode: 1,
						reason: "non-zero-exit",
					}),
				),
			);

			const release = yield* lookupRegistryRelease(
				"/project",
				"Yarn",
				"@acme/missing",
			).pipe(Effect.provide(layer));

			expect(release).toEqual(Option.none());
		}),
	);

	it.effect("returns nothing for output that is not a release", () =>
		Effect.gen(function* () {
			const { layer } = subprocessReturning(() => Effect.succeed('"2.3.4"'));

			const release = yield* lookupRegistryRelease(
				"/project",
				"pnpm",
				"@acme/forge-sentry",
			).pipe(Effect.provide(layer));

			expect(release).toEqual(Option.none());
		}),
	);

	it("resolves to undefined through the CLI runtime when the lookup cannot run", async () => {
		await expect(
			resolveRegistryRelease(
				join(import.meta.dirname, "missing-project"),
				"pnpm",
				"@acme/forge-sentry",
			),
		).resolves.toBeUndefined();
	});
});
