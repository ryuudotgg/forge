import { dirname, join } from "node:path";
import { FileSystem } from "@effect/platform";
import { Effect } from "effect";
import { ApplyError } from "./errors";
import type { Lockfile, Manifest } from "./state";
import { buildProvenanceIndex, State } from "./state";

export interface PlannedWrite {
	readonly content: string;
	readonly path: string;
}

export interface ApplyPlan {
	readonly lockfile: Lockfile;
	readonly manifest: Manifest;
	readonly removals: ReadonlyArray<string>;
	readonly writes: ReadonlyArray<PlannedWrite>;
}

export class Apply extends Effect.Service<Apply>()("Apply", {
	accessors: true,
	effect: Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;

		const hashContent = Effect.fn("Apply.hashContent")(function* (
			content: string,
		) {
			const encoder = new TextEncoder();
			const data = encoder.encode(content);

			const buffer = yield* Effect.tryPromise({
				try: () => globalThis.crypto.subtle.digest("SHA-256", data),
				catch: () =>
					new ApplyError({
						path: "content",
						message: "Content Hash Failed",
					}),
			});

			return Array.from(new Uint8Array(buffer))
				.map((byte) => byte.toString(16).padStart(2, "0"))
				.join("");
		});

		const applyPlan = Effect.fn("Apply.applyPlan")(function* (
			projectRoot: string,
			plan: ApplyPlan,
		) {
			const previousLockfile = yield* State.readLockfile(projectRoot);
			const previousArtifacts = buildProvenanceIndex(previousLockfile).byPath;
			const writesToApply: PlannedWrite[] = [];

			for (const relativePath of plan.removals) {
				const fullPath = join(projectRoot, relativePath);
				const exists = yield* fs.exists(fullPath);
				if (!exists) continue;

				const previousArtifact = previousArtifacts.get(relativePath);
				if (!previousArtifact)
					return yield* new ApplyError({
						path: relativePath,
						message: "Unmanaged File Exists",
					});

				const currentContent = yield* fs.readFileString(fullPath).pipe(
					Effect.catchTag(
						"SystemError",
						() =>
							new ApplyError({
								path: relativePath,
								message: "File Read Failed",
							}),
					),
				);

				const currentHash = yield* hashContent(currentContent);
				if (currentHash !== previousArtifact.hash)
					return yield* new ApplyError({
						path: relativePath,
						message: "Managed File Modified",
					});
			}

			for (const file of plan.writes) {
				const fullPath = join(projectRoot, file.path);
				const exists = yield* fs.exists(fullPath);
				const nextHash = yield* hashContent(file.content);

				if (!exists) {
					writesToApply.push(file);
					continue;
				}

				const currentContent = yield* fs.readFileString(fullPath).pipe(
					Effect.catchTag(
						"SystemError",
						() =>
							new ApplyError({
								path: file.path,
								message: "File Read Failed",
							}),
					),
				);
				const currentHash = yield* hashContent(currentContent);
				if (currentHash === nextHash) continue;

				const previousArtifact = previousArtifacts.get(file.path);
				if (!previousArtifact)
					return yield* new ApplyError({
						path: file.path,
						message: "Unmanaged File Exists",
					});

				if (currentHash !== previousArtifact.hash)
					return yield* new ApplyError({
						path: file.path,
						message: "Managed File Modified",
					});

				writesToApply.push(file);
			}

			for (const relativePath of plan.removals) {
				const fullPath = join(projectRoot, relativePath);
				const exists = yield* fs.exists(fullPath);
				if (!exists) continue;

				yield* fs.remove(fullPath).pipe(
					Effect.catchTag(
						"SystemError",
						() =>
							new ApplyError({
								path: relativePath,
								message: "File Remove Failed",
							}),
					),
				);
			}

			for (const file of writesToApply) {
				const fullPath = join(projectRoot, file.path);
				const directory = dirname(fullPath);

				yield* fs.makeDirectory(directory, { recursive: true }).pipe(
					Effect.catchTag(
						"SystemError",
						() =>
							new ApplyError({
								path: file.path,
								message: "Directory Write Failed",
							}),
					),
				);

				yield* fs.writeFileString(fullPath, file.content).pipe(
					Effect.catchTag(
						"SystemError",
						() =>
							new ApplyError({
								path: file.path,
								message: "File Write Failed",
							}),
					),
				);
			}

			yield* State.writeManifest(projectRoot, plan.manifest);
			yield* State.writeLockfile(projectRoot, plan.lockfile);
		});

		return { applyPlan };
	}),
}) {}
