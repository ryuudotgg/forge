import { readFile } from "node:fs/promises";
import { NodeContext } from "@effect/platform-node";
import { Cause, Effect, Exit, Layer, Option } from "effect";
import { describe, expect, it } from "vitest";
import { Apply, type ApplyError, CoreLive, State } from "../src/index";
import { withTempDir, writeJson, writeText } from "./harness";

const coreLayer = CoreLive.pipe(Layer.provideMerge(NodeContext.layer));

async function hashContent(content: string) {
	const buffer = await crypto.subtle.digest(
		"SHA-256",
		new TextEncoder().encode(content),
	);

	return Array.from(new Uint8Array(buffer))
		.map((byte) => byte.toString(16).padStart(2, "0"))
		.join("");
}

describe("apply", () => {
	it("refuses to overwrite a modified managed file", async () => {
		await withTempDir("apply-overwrite", async (directory) => {
			await writeText(`${directory}/apps/web/app/layout.tsx`, "user-change\n");
			await writeJson(`${directory}/.forge/manifest.json`, {
				config: {},
				installs: [],
				modules: {},
			});

			await Effect.runPromise(
				State.writeLockfile(directory, {
					resolutions: {},
					provenance: {
						artifacts: {
							"project:file:apps/web/app/layout.tsx": {
								definitionIds: ["nextjs/base"],
								hash: await hashContent("old-managed\n"),
								kind: "file",
								path: "apps/web/app/layout.tsx",
								target: { kind: "project" },
							},
						},
					},
				}).pipe(Effect.provide(coreLayer)),
			);

			await expect(
				Effect.runPromiseExit(
					Apply.applyPlan(directory, {
						lockfile: {
							resolutions: {},
							provenance: { artifacts: {} },
						},
						manifest: {
							config: {},
							installs: [],
							modules: {},
						},
						removals: [],
						writes: [
							{
								content: "new-managed\n",
								path: "apps/web/app/layout.tsx",
							},
						],
					}).pipe(Effect.provide(coreLayer)),
				),
			).resolves.toSatisfy((exit) => {
				if (!Exit.isFailure(exit)) return false;

				const failure = Cause.failureOption(exit.cause);
				if (Option.isNone(failure)) return false;

				const error = failure.value as ApplyError;

				return (
					error._tag === "ApplyError" &&
					error.message === "Managed File Modified"
				);
			});

			expect(
				await readFile(`${directory}/apps/web/app/layout.tsx`, "utf-8"),
			).toBe("user-change\n");
		});
	});

	it("refuses to remove a modified managed file", async () => {
		await withTempDir("apply-remove", async (directory) => {
			await writeText(`${directory}/packages/ui/forge.json`, "{\n}\n");
			await writeJson(`${directory}/.forge/manifest.json`, {
				config: {},
				installs: [],
				modules: {},
			});

			await Effect.runPromise(
				State.writeLockfile(directory, {
					resolutions: {},
					provenance: {
						artifacts: {
							"project:file:packages/ui/forge.json": {
								definitionIds: ["ui"],
								hash: await hashContent('{\n\t"old": true\n}\n'),
								kind: "file",
								path: "packages/ui/forge.json",
								target: { kind: "project" },
							},
						},
					},
				}).pipe(Effect.provide(coreLayer)),
			);

			await expect(
				Effect.runPromiseExit(
					Apply.applyPlan(directory, {
						lockfile: {
							resolutions: {},
							provenance: { artifacts: {} },
						},
						manifest: {
							config: {},
							installs: [],
							modules: {},
						},
						removals: ["packages/ui/forge.json"],
						writes: [],
					}).pipe(Effect.provide(coreLayer)),
				),
			).resolves.toSatisfy((exit) => {
				if (!Exit.isFailure(exit)) return false;

				const failure = Cause.failureOption(exit.cause);
				if (Option.isNone(failure)) return false;

				const error = failure.value as ApplyError;

				return (
					error._tag === "ApplyError" &&
					error.message === "Managed File Modified"
				);
			});

			expect(
				await readFile(`${directory}/packages/ui/forge.json`, "utf-8"),
			).toBe("{\n}\n");
		});
	});
});
