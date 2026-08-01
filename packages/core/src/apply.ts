import { rmdir } from "node:fs/promises";
import {
	basename,
	dirname,
	isAbsolute,
	relative,
	resolve,
	sep,
} from "node:path";
import { FileSystem } from "@effect/platform";
import { Effect } from "effect";
import { ApplyError } from "./errors";
import { formatJson } from "./format/json";
import { hashContentHex } from "./hash";
import { envResidue, threeWayMergeEnv } from "./merge/env";
import { jsonResidue, threeWayMergeJson } from "./merge/json";
import { sectionResidue, threeWayMergeSections } from "./merge/lines";
import { sortPackageJson } from "./sort/package-json";
import type {
	Lockfile,
	LockfileArtifact,
	LockfileInput,
	Manifest,
	ManifestInput,
	StateBundle,
	SurfaceMergeKind,
} from "./state";
import {
	buildArtifactIndex,
	State,
	SURFACE_MERGE_SEMANTICS_VERSION,
} from "./state";

export interface PlannedWrite {
	readonly artifactId?: string;
	readonly content: string;
	readonly path: string;
}

export interface ApplyPlan {
	readonly lockfile: LockfileInput;
	readonly manifest: ManifestInput;
	readonly removals: ReadonlyArray<string>;
	readonly writes: ReadonlyArray<PlannedWrite>;
}

interface MergeConflict {
	readonly base: unknown;
	readonly forge: unknown;
	readonly label: string;
	readonly user: unknown;
}

interface PolicyRefusal {
	readonly message: "Managed File Modified" | "Unmanaged File Exists";
	readonly path: string;
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function movedModuleArtifactId(
	write: PlannedWrite,
	current: ManifestInput,
	previous: Manifest,
): string | undefined {
	if (write.artifactId === undefined) return undefined;

	const match = /^module:([^:]+):file:(.+)$/.exec(write.artifactId);
	const moduleId = match?.[1];
	const artifactPath = match?.[2];
	if (
		moduleId === undefined ||
		artifactPath === undefined ||
		artifactPath !== write.path
	)
		return undefined;

	const nextRoot = current.modules[moduleId]?.root;
	const previousRoot = previous.modules[moduleId]?.root;
	if (
		nextRoot === undefined ||
		previousRoot === undefined ||
		nextRoot === previousRoot ||
		!write.path.startsWith(`${nextRoot}/`)
	)
		return undefined;

	const relativePath = write.path.slice(nextRoot.length + 1);
	return `module:${moduleId}:file:${previousRoot}/${relativePath}`;
}

function isUserOwnedEnv(relativePath: string): boolean {
	return basename(relativePath) === ".env";
}

function valueAtPath(
	value: Record<string, unknown>,
	path: ReadonlyArray<string>,
): unknown {
	let current: unknown = value;
	for (const segment of path) {
		if (!isJsonObject(current) || !Object.hasOwn(current, segment))
			return undefined;
		current = current[segment];
	}
	return current;
}

function formatJsonPath(path: ReadonlyArray<string>): string {
	return path
		.map((segment, index) =>
			/^[A-Za-z_$][\w$]*$/.test(segment)
				? index === 0
					? segment
					: `.${segment}`
				: `[${JSON.stringify(segment)}]`,
		)
		.join("");
}

function describeConflictValue(value: unknown): string {
	if (value === undefined) return "missing";
	const serialized = JSON.stringify(value);
	if (serialized === undefined) return String(value);
	return serialized.length <= 120
		? serialized
		: `${serialized.slice(0, 117)}...`;
}

function conflictMessage(conflicts: ReadonlyArray<MergeConflict>): string {
	const lines = conflicts.map(
		(conflict) =>
			`${conflict.label}: base was ${describeConflictValue(conflict.base)}, user has ${describeConflictValue(conflict.user)}, and forge wants ${describeConflictValue(conflict.forge)}.`,
	);

	return `Semantic merge conflicts were found:\n${lines.join("\n")}\nResolve each conflict, then run Forge again.`;
}

function refusalSentence(refusal: PolicyRefusal): string {
	return refusal.message === "Managed File Modified"
		? `${refusal.path} was modified after Forge last managed it.`
		: `${refusal.path} already exists and is not managed by Forge.`;
}

function preflightMessage(
	refusals: ReadonlyArray<PolicyRefusal>,
	conflicts: ReadonlyArray<MergeConflict>,
): string {
	const sections: string[] = [];
	if (refusals.length > 0)
		sections.push(
			`Forge cannot safely update these files:\n${refusals
				.map(refusalSentence)
				.join("\n")}`,
		);

	if (conflicts.length > 0) sections.push(conflictMessage(conflicts));

	return sections.join("\n");
}

export function formatApplyError(error: ApplyError): string {
	if (
		error.message === "Managed File Modified" ||
		error.message === "Unmanaged File Exists"
	)
		return preflightMessage([{ message: error.message, path: error.path }], []);

	return error.message;
}

function formatMergedJson(
	path: string,
	value: Record<string, unknown>,
): string {
	const sorted = path.endsWith("package.json") ? sortPackageJson(value) : value;
	return formatJson(sorted, { compact: !path.endsWith("package.json") });
}

export class Apply extends Effect.Service<Apply>()("Apply", {
	accessors: true,
	effect: Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;

		const ensureContained = Effect.fn("Apply.ensureContained")(function* (
			projectRoot: string,
			relativePath: string,
		) {
			const rootPath = resolve(projectRoot);
			const fullPath = resolve(rootPath, relativePath);

			if (
				isAbsolute(relativePath) ||
				(fullPath !== rootPath && !fullPath.startsWith(`${rootPath}${sep}`))
			)
				return yield* new ApplyError({
					path: relativePath,
					message: "Path Escapes Project Root",
				});

			const realRoot = yield* fs
				.realPath(rootPath)
				.pipe(Effect.orElseSucceed(() => null));

			if (realRoot === null) return fullPath;

			let ancestor = fullPath;
			while (ancestor !== rootPath) {
				const realAncestor = yield* fs
					.realPath(ancestor)
					.pipe(Effect.orElseSucceed(() => null));

				if (realAncestor !== null) {
					if (
						realAncestor === realRoot ||
						realAncestor.startsWith(`${realRoot}${sep}`)
					)
						return fullPath;

					return yield* new ApplyError({
						path: relativePath,
						message: "Path Escapes Project Root",
					});
				}

				ancestor = dirname(ancestor);
			}

			return fullPath;
		});

		const hashContent = Effect.fn("Apply.hashContent")(function* (
			content: string,
		) {
			return yield* hashContentHex(
				content,
				() =>
					new ApplyError({ path: "content", message: "Content Hash Failed" }),
			);
		});

		const readFile = Effect.fn("Apply.readFile")(function* (
			path: string,
			label: string,
		) {
			return yield* fs
				.readFileString(path)
				.pipe(
					Effect.catchTag(
						"SystemError",
						() => new ApplyError({ path: label, message: "File Read Failed" }),
					),
				);
		});

		const parseJsonObject = Effect.fn("Apply.parseJsonObject")(function* (
			content: string,
			path: string,
			message:
				| "Managed File Modified"
				| "Managed JSON Parse Failed" = "Managed JSON Parse Failed",
		) {
			return yield* Effect.try({
				try: () => {
					const parsed: unknown = JSON.parse(content);
					if (!isJsonObject(parsed)) throw new Error("Expected a JSON object");
					return parsed;
				},
				catch: () => new ApplyError({ path, message }),
			});
		});

		const readBase = Effect.fn("Apply.readBase")(function* (
			projectRoot: string,
			artifact: LockfileArtifact,
		) {
			if (artifact.base === undefined)
				return yield* new ApplyError({
					path: artifact.path,
					message: "Managed File Modified",
				});

			return yield* State.readBase(projectRoot, artifact.base.hash).pipe(
				Effect.mapError(
					() =>
						new ApplyError({
							path: artifact.path,
							message: "Managed Base Read Failed",
						}),
				),
			);
		});

		const mergeSurface = Effect.fn("Apply.mergeSurface")(function* (
			kind: SurfaceMergeKind,
			path: string,
			base: string,
			current: string,
			incoming: string,
		) {
			if (kind === "env") return threeWayMergeEnv(base, current, incoming);
			if (kind === "lines")
				return threeWayMergeSections(base, current, incoming);

			const baseJson = yield* parseJsonObject(base, path);
			const currentJson = yield* parseJsonObject(
				current,
				path,
				"Managed File Modified",
			);

			const incomingJson = yield* parseJsonObject(incoming, path);

			const result = threeWayMergeJson(baseJson, currentJson, incomingJson, {
				preserveDependencyRemovals: path.endsWith("package.json"),
			});

			return {
				merged: formatMergedJson(path, result.merged),
				conflicts: result.conflicts,
				json: { base: baseJson, current: currentJson, incoming: incomingJson },
			};
		});

		const surfaceResidue = Effect.fn("Apply.surfaceResidue")(function* (
			kind: SurfaceMergeKind,
			path: string,
			base: string,
			current: string,
		) {
			if (kind === "env") return envResidue(base, current);
			if (kind === "lines") return sectionResidue(base, current);

			const baseJson = yield* parseJsonObject(base, path);
			const currentJson = yield* parseJsonObject(
				current,
				path,
				"Managed File Modified",
			);

			const residue = jsonResidue(baseJson, currentJson);
			return Object.keys(residue).length === 0
				? ""
				: formatMergedJson(path, residue);
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

			const committedArtifacts: Record<string, LockfileArtifact> =
				Object.fromEntries(
					Object.entries(plan.lockfile.artifacts).map(([id, artifact]) => [
						id,
						{ ...artifact },
					]),
				);

			const writesToApply: PlannedWrite[] = [];
			const removalsToApply: string[] = [];

			const conflicts: MergeConflict[] = [];
			const refusals: PolicyRefusal[] = [];

			for (const relativePath of plan.removals) {
				const fullPath = yield* ensureContained(projectRoot, relativePath);
				if (isUserOwnedEnv(relativePath)) continue;
				if (!(yield* fs.exists(fullPath))) continue;

				const previousArtifact = previousArtifacts.get(relativePath);
				if (previousArtifact === undefined) {
					refusals.push({
						path: relativePath,
						message: "Unmanaged File Exists",
					});

					continue;
				}

				const currentContent = yield* readFile(fullPath, relativePath);
				const currentHash = yield* hashContent(currentContent);
				if (
					currentHash === previousArtifact.hash &&
					(previousArtifact.base === undefined ||
						previousArtifact.base.hash === currentHash)
				) {
					removalsToApply.push(relativePath);
					continue;
				}

				const baseDescriptor = previousArtifact.base;
				if (
					baseDescriptor === undefined ||
					baseDescriptor.semanticsVersion !== SURFACE_MERGE_SEMANTICS_VERSION
				) {
					refusals.push({
						path: relativePath,
						message: "Managed File Modified",
					});

					continue;
				}

				const base = yield* readBase(projectRoot, previousArtifact);
				const residueResult = yield* Effect.either(
					surfaceResidue(
						baseDescriptor.mergeKind,
						relativePath,
						base,
						currentContent,
					),
				);

				if (residueResult._tag === "Left") {
					if (residueResult.left.message !== "Managed File Modified")
						return yield* residueResult.left;

					refusals.push({
						path: relativePath,
						message: "Managed File Modified",
					});

					continue;
				}

				const residue = residueResult.right;
				if (residue === "") removalsToApply.push(relativePath);
				else
					writesToApply.push({
						content: residue,
						path: relativePath,
					});
			}

			for (const file of plan.writes) {
				const fullPath = yield* ensureContained(projectRoot, file.path);
				if (!(yield* fs.exists(fullPath))) {
					writesToApply.push(file);
					continue;
				}

				if (isUserOwnedEnv(file.path)) continue;

				const currentContent = yield* readFile(fullPath, file.path);

				const currentHash = yield* hashContent(currentContent);
				const nextHash = yield* hashContent(file.content);

				if (/^module:[^:]+:file:forge\.json$/.test(file.artifactId ?? "")) {
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
				const nextArtifact =
					file.artifactId === undefined
						? undefined
						: committedArtifacts[file.artifactId];

				const managedArtifact = previousArtifact ?? movedArtifact;

				const previousBase = managedArtifact?.base;
				const nextBase = nextArtifact?.base;

				const descriptorsCompatible =
					previousBase === undefined
						? nextBase === undefined ||
							nextBase.semanticsVersion === SURFACE_MERGE_SEMANTICS_VERSION
						: nextBase !== undefined &&
							previousBase.mergeKind === nextBase.mergeKind &&
							previousBase.semanticsVersion === nextBase.semanticsVersion &&
							nextBase.semanticsVersion === SURFACE_MERGE_SEMANTICS_VERSION;

				if (currentHash === nextHash && descriptorsCompatible) continue;
				if (previousArtifact === undefined && movedArtifact === undefined) {
					refusals.push({
						path: file.path,
						message: "Unmanaged File Exists",
					});

					continue;
				}

				if (managedArtifact === undefined) {
					refusals.push({
						path: file.path,
						message: "Managed File Modified",
					});

					continue;
				}

				const currentIsPureRender =
					managedArtifact.base === undefined ||
					managedArtifact.base.hash === currentHash;

				if (currentHash === managedArtifact.hash && currentIsPureRender) {
					writesToApply.push(file);
					continue;
				}

				if (
					previousBase === undefined ||
					nextBase === undefined ||
					previousBase.mergeKind !== nextBase.mergeKind ||
					previousBase.semanticsVersion !== nextBase.semanticsVersion ||
					nextBase.semanticsVersion !== SURFACE_MERGE_SEMANTICS_VERSION
				) {
					refusals.push({
						path: file.path,
						message: "Managed File Modified",
					});

					continue;
				}

				const base = yield* readBase(projectRoot, managedArtifact);
				const mergedResult = yield* Effect.either(
					mergeSurface(
						previousBase.mergeKind,
						file.path,
						base,
						currentContent,
						file.content,
					),
				);

				if (mergedResult._tag === "Left") {
					if (mergedResult.left.message !== "Managed File Modified")
						return yield* mergedResult.left;

					refusals.push({
						path: file.path,
						message: "Managed File Modified",
					});

					continue;
				}

				const merged = mergedResult.right;
				if ("json" in merged)
					for (const conflict of merged.conflicts)
						conflicts.push({
							base: valueAtPath(merged.json.base, conflict),
							forge: valueAtPath(merged.json.incoming, conflict),
							label: `${file.path} -> ${formatJsonPath(conflict)}`,
							user: valueAtPath(merged.json.current, conflict),
						});
				else
					for (const [index, conflict] of merged.conflicts.entries()) {
						const values = merged.conflictValues?.[index];
						conflicts.push({
							base: values?.base,
							forge: values?.forge,
							label: `${file.path} -> ${conflict}`,
							user: values?.user,
						});
					}

				if (merged.conflicts.length === 0) {
					const mergedWrite = { ...file, content: merged.merged };
					writesToApply.push(mergedWrite);

					if (file.artifactId !== undefined && nextArtifact !== undefined)
						committedArtifacts[file.artifactId] = {
							...nextArtifact,
							hash: yield* hashContent(merged.merged),
						};
				}
			}

			const refusal = refusals.length === 1 ? refusals[0] : undefined;
			if (refusal !== undefined && conflicts.length === 0)
				return yield* new ApplyError({
					path: refusal.path,
					message: refusal.message,
				});

			if (refusals.length > 0 || conflicts.length > 0)
				return yield* new ApplyError({
					path: refusals.length === 0 ? "managed surfaces" : "managed files",
					message: preflightMessage(refusals, conflicts),
				});

			const committedManifest = {
				...plan.manifest,
				schemaVersion: 1,
			} satisfies Manifest;

			const committedLockfile = {
				...plan.lockfile,
				artifacts: committedArtifacts,
				schemaVersion: 1,
			} satisfies Lockfile;

			const previousStateBundle = {
				lockfile: previousLockfile,
				manifest: previousManifest,
			} satisfies StateBundle;

			const pureWritesById = new Map(
				plan.writes.flatMap((write) =>
					write.artifactId === undefined
						? []
						: [[write.artifactId, write.content]],
				),
			);

			const bases = new Map<string, string>();
			for (const [artifactId, artifact] of Object.entries(
				committedLockfile.artifacts,
			)) {
				if (artifact.base === undefined) continue;
				if (artifact.kind !== "surface" || isUserOwnedEnv(artifact.path))
					return yield* new ApplyError({
						path: artifact.path,
						message: "Managed Base Forbidden",
					});

				const content = pureWritesById.get(artifactId);
				if (content === undefined)
					return yield* new ApplyError({
						path: artifact.path,
						message: "Managed Base Content Missing",
					});

				if ((yield* hashContent(content)) !== artifact.base.hash)
					return yield* new ApplyError({
						path: artifact.path,
						message: "Managed Base Hash Mismatch",
					});

				bases.set(artifact.base.hash, content);
			}

			const validateExistingBases = Effect.fn("Apply.validateExistingBases")(
				function* () {
					for (const hash of bases.keys()) {
						const baseRelative = `.forge/bases/${hash}`;
						const destination = yield* ensureContained(
							projectRoot,
							baseRelative,
						);

						if (!(yield* fs.exists(destination))) continue;

						const existing = yield* readFile(destination, baseRelative);
						if ((yield* hashContent(existing)) !== hash)
							return yield* new ApplyError({
								path: baseRelative,
								message: "Managed Base Hash Mismatch",
							});
					}
				},
			);

			yield* validateExistingBases();

			const stagingRootRelative = ".forge";
			const stagingRoot = yield* ensureContained(
				projectRoot,
				stagingRootRelative,
			);

			yield* fs.makeDirectory(stagingRoot, { recursive: true }).pipe(
				Effect.catchTag(
					"SystemError",
					() =>
						new ApplyError({
							path: stagingRootRelative,
							message: "Staging Directory Failed",
						}),
				),
			);

			const stagingDirectory = yield* fs
				.makeTempDirectory({ directory: stagingRoot, prefix: ".staging-" })
				.pipe(
					Effect.catchTag(
						"SystemError",
						() =>
							new ApplyError({
								path: stagingRootRelative,
								message: "Staging Directory Failed",
							}),
					),
				);

			const stagingRelative = relative(resolve(projectRoot), stagingDirectory);
			yield* ensureContained(projectRoot, stagingRelative);

			const stageWrite = Effect.fn("Apply.stageWrite")(function* (
				relativePath: string,
				content: string,
			) {
				const stagedRelative = `${stagingRelative}/${relativePath}`;
				const stagedPath = yield* ensureContained(projectRoot, stagedRelative);

				yield* fs.makeDirectory(dirname(stagedPath), { recursive: true }).pipe(
					Effect.catchTag(
						"SystemError",
						() =>
							new ApplyError({
								path: stagedRelative,
								message: "Staged Directory Write Failed",
							}),
					),
				);

				yield* fs.writeFileString(stagedPath, content).pipe(
					Effect.catchTag(
						"SystemError",
						() =>
							new ApplyError({
								path: stagedRelative,
								message: "Staged File Write Failed",
							}),
					),
				);

				return stagedPath;
			});

			const commit = Effect.gen(function* () {
				const stagedWrites: Array<{
					readonly path: string;
					readonly stagedPath: string;
				}> = [];

				for (const write of writesToApply)
					stagedWrites.push({
						path: write.path,
						stagedPath: yield* stageWrite(`files/${write.path}`, write.content),
					});

				const stagedBases: Array<{
					readonly hash: string;
					readonly stagedPath: string;
				}> = [];

				for (const [hash, content] of bases)
					stagedBases.push({
						hash,
						stagedPath: yield* stageWrite(`bases/${hash}`, content),
					});

				const stagedManifest = yield* stageWrite(
					"state/manifest.json",
					formatJson(committedManifest, { compact: false }),
				);

				const stagedLockfile = yield* stageWrite(
					"state/lock.json",
					formatJson(committedLockfile, { compact: false }),
				);

				const stagedPreviousStateBundle = yield* stageWrite(
					"state/previous-state.json",
					formatJson(previousStateBundle, { compact: false }),
				);

				yield* validateExistingBases();
				const stateBundlePath = yield* ensureContained(
					projectRoot,
					".forge/state.json",
				);

				if (!(yield* fs.exists(stateBundlePath)))
					yield* fs.rename(stagedPreviousStateBundle, stateBundlePath).pipe(
						Effect.catchTag(
							"SystemError",
							() =>
								new ApplyError({
									path: ".forge/state.json",
									message: "Atomic State Backup Failed",
								}),
						),
					);

				for (const relativePath of removalsToApply) {
					const fullPath = yield* ensureContained(projectRoot, relativePath);
					if (!(yield* fs.exists(fullPath))) continue;

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

				for (const staged of stagedWrites) {
					const fullPath = yield* ensureContained(projectRoot, staged.path);
					yield* fs.makeDirectory(dirname(fullPath), { recursive: true }).pipe(
						Effect.catchTag(
							"SystemError",
							() =>
								new ApplyError({
									path: staged.path,
									message: "Directory Write Failed",
								}),
						),
					);

					yield* fs.rename(staged.stagedPath, fullPath).pipe(
						Effect.catchTag(
							"SystemError",
							() =>
								new ApplyError({
									path: staged.path,
									message: "Atomic File Write Failed",
								}),
						),
					);
				}

				const basesDirectory = yield* ensureContained(
					projectRoot,
					".forge/bases",
				);

				yield* fs.makeDirectory(basesDirectory, { recursive: true }).pipe(
					Effect.catchTag(
						"SystemError",
						() =>
							new ApplyError({
								path: ".forge/bases",
								message: "Base Directory Failed",
							}),
					),
				);

				for (const staged of stagedBases) {
					const baseRelative = `.forge/bases/${staged.hash}`;
					const destination = yield* ensureContained(projectRoot, baseRelative);
					if (yield* fs.exists(destination)) continue;

					yield* fs.rename(staged.stagedPath, destination).pipe(
						Effect.catchTag(
							"SystemError",
							() =>
								new ApplyError({
									path: baseRelative,
									message: "Atomic Base Write Failed",
								}),
						),
					);
				}

				const manifestPath = yield* ensureContained(
					projectRoot,
					".forge/manifest.json",
				);

				const lockfilePath = yield* ensureContained(
					projectRoot,
					".forge/lock.json",
				);

				yield* fs.rename(stagedManifest, manifestPath).pipe(
					Effect.mapError(
						() =>
							new ApplyError({
								path: ".forge/manifest.json",
								message: "Atomic Manifest Write Failed",
							}),
					),
				);

				yield* fs.rename(stagedLockfile, lockfilePath).pipe(
					Effect.mapError(
						() =>
							new ApplyError({
								path: ".forge/lock.json",
								message: "Atomic Lockfile Write Failed",
							}),
					),
				);

				yield* fs.remove(stateBundlePath).pipe(
					Effect.catchTag(
						"SystemError",
						() =>
							new ApplyError({
								path: ".forge/state.json",
								message: "Atomic State Publish Failed",
							}),
					),
				);

				yield* State.garbageCollectBases(projectRoot, committedLockfile).pipe(
					Effect.catchTag("StateError", () => Effect.void),
				);
			}).pipe(
				Effect.ensuring(
					fs
						.remove(stagingDirectory, { recursive: true })
						.pipe(Effect.orElseSucceed(() => undefined)),
				),
			);

			yield* commit;

			const rootPath = resolve(projectRoot);
			const realRoot = yield* fs
				.realPath(rootPath)
				.pipe(Effect.orElseSucceed(() => null));

			for (const relativePath of realRoot === null ? [] : removalsToApply) {
				let directory = dirname(resolve(projectRoot, relativePath));
				while (
					directory !== rootPath &&
					directory.startsWith(`${rootPath}${sep}`)
				) {
					const realDirectory = yield* fs
						.realPath(directory)
						.pipe(Effect.orElseSucceed(() => null));

					if (
						realDirectory === null ||
						!realDirectory.startsWith(`${realRoot}${sep}`)
					)
						break;

					const removed = yield* Effect.tryPromise(() => rmdir(directory)).pipe(
						Effect.as(true),
						Effect.orElseSucceed(() => false),
					);

					if (!removed) break;
					directory = dirname(directory);
				}
			}
		});

		return { applyPlan };
	}),
}) {}
