import { rmdir } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { FileSystem } from "@effect/platform";
import { Effect } from "effect";
import { ApplyError } from "./errors";
import type { Lockfile, Manifest } from "./state";
import { buildArtifactIndex, State } from "./state";

export interface PlannedWrite {
	readonly artifactId?: string;
	readonly content: string;
	readonly path: string;
}

export interface ApplyPlan {
	readonly lockfile: Lockfile;
	readonly manifest: Manifest;
	readonly removals: ReadonlyArray<string>;
	readonly writes: ReadonlyArray<PlannedWrite>;
}

function movedModuleArtifactId(
	write: PlannedWrite,
	current: Manifest,
	previous: Manifest,
): string | undefined {
	if (write.artifactId === undefined) return undefined;

	const match = /^module:([^:]+):file:(.+)$/.exec(write.artifactId);

	const moduleId = match?.[1];
	const artifactPath = match?.[2];
	if (moduleId === undefined || artifactPath !== write.path) return undefined;

	const nextRoot = current.modules[moduleId]?.root;
	const previousRoot = previous.modules[moduleId]?.root;
	if (
		nextRoot === undefined ||
		previousRoot === undefined ||
		nextRoot === previousRoot ||
		!write.path.startsWith(`${nextRoot}/`)
	)
		return undefined;

	const relative = write.path.slice(nextRoot.length + 1);
	return `module:${moduleId}:file:${previousRoot}/${relative}`;
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
			const previousManifest = yield* State.readManifestOrDefault(projectRoot);
			const previousArtifactIndex = buildArtifactIndex(previousLockfile);
			const previousArtifacts = previousArtifactIndex.byPath;
			const previousArtifactsById = previousArtifactIndex.byId;

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

				if (file.artifactId?.endsWith(":file:forge.json")) {
					writesToApply.push(file);
					continue;
				}

				const previousArtifact = previousArtifacts.get(file.path);
				const renamedArtifactId = movedModuleArtifactId(
					file,
					plan.manifest,
					previousManifest,
				);

				const movedArtifact =
					(file.artifactId === undefined
						? undefined
						: previousArtifactsById.get(file.artifactId)) ??
					(renamedArtifactId === undefined
						? undefined
						: previousArtifactsById.get(renamedArtifactId));

				if (!previousArtifact)
					if (!movedArtifact)
						return yield* new ApplyError({
							path: file.path,
							message: "Unmanaged File Exists",
						});

				const expectedHash = previousArtifact?.hash ?? movedArtifact?.hash;
				if (expectedHash === undefined || currentHash !== expectedHash)
					return yield* new ApplyError({
						path: file.path,
						message: "Managed File Modified",
					});

				writesToApply.push(file);
			}

			const removedPaths: string[] = [];
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
				removedPaths.push(relativePath);
			}

			const rootPath = resolve(projectRoot);
			const realRoot = yield* fs
				.realPath(rootPath)
				.pipe(Effect.catchAll(() => Effect.succeed(null)));

			for (const relativePath of realRoot === null ? [] : removedPaths) {
				let directory = dirname(resolve(projectRoot, relativePath));

				while (
					directory !== rootPath &&
					directory.startsWith(`${rootPath}${sep}`)
				) {
					const realDirectory = yield* fs
						.realPath(directory)
						.pipe(Effect.catchAll(() => Effect.succeed(null)));

					if (
						realDirectory === null ||
						!realDirectory.startsWith(`${realRoot}${sep}`)
					)
						break;

					const removed = yield* Effect.tryPromise(() => rmdir(directory)).pipe(
						Effect.as(true),
						Effect.catchAll(() => Effect.succeed(false)),
					);

					if (!removed) break;

					directory = dirname(directory);
				}
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
