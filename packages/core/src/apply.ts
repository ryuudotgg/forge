import { rmdir } from "node:fs/promises";
import {
	basename,
	dirname,
	isAbsolute,
	relative,
	resolve,
	sep,
} from "node:path";
import { Context, Effect, FileSystem, Layer, Result } from "effect";
import { ApplyError, type ApplyRefusalReason } from "./errors";
import { formatJson } from "./format/json";
import { hashContentHex } from "./hash";
import { envResidue, threeWayMergeEnv } from "./merge/env";
import { jsonResidue, threeWayMergeJson } from "./merge/json";
import { sectionResidue, threeWayMergeSections } from "./merge/lines";
import type { MergeConflictResolution } from "./merge/types";
import { sortPackageJson } from "./sort/package-json";
import type {
	ArtifactBase,
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
	readonly baseContents?: Readonly<Record<string, string>>;
	readonly lockfile: LockfileInput;
	readonly manifest: ManifestInput;
	readonly removals: ReadonlyArray<string>;
	readonly writes: ReadonlyArray<PlannedWrite>;
}

export type ResolutionPolicy = "accept-forge" | "keep-user" | "refuse";
export type ConflictResolution = "forge" | "user";

export type ApplyResolution =
	| { readonly resolution: ConflictResolution }
	| {
			readonly expected: {
				readonly forge: unknown;
				readonly user: unknown;
			};
			readonly resolution: ConflictResolution;
	  };

export interface ApplyOptions {
	readonly conflictResolutions?: Readonly<Record<string, ApplyResolution>>;
	readonly resolutionPolicy?: ResolutionPolicy;
}

export interface FormatApplyErrorOptions {
	readonly includeResolutionGuidance?: boolean;
}

export interface ApplyConflict {
	readonly base: unknown;
	readonly forge: unknown;
	readonly label: string;
	readonly user: unknown;
}

export interface ApplyRefusal {
	readonly reason: ApplyRefusalReason;
	readonly operation: "removal" | "write";
	readonly path: string;
	readonly resolvable: boolean;
}

interface PreflightClassification {
	readonly conflicts: ReadonlyArray<ApplyConflict>;
	readonly hasConflicts: boolean;
	readonly hasManagedRemovals: boolean;
	readonly hasManagedRefusals: boolean;
	readonly hasUnmanagedRefusals: boolean;
	readonly hasUnmanagedRemovals: boolean;
	readonly refusals: ReadonlyArray<ApplyRefusal>;
}

function classifyPreflight(
	refusals: ReadonlyArray<ApplyRefusal>,
	conflicts: ReadonlyArray<ApplyConflict>,
): PreflightClassification {
	return {
		refusals,
		conflicts,
		hasConflicts: conflicts.length > 0,
		hasManagedRemovals: refusals.some(
			(refusal) =>
				refusal.reason === "managed-file-modified" &&
				refusal.operation === "removal",
		),
		hasManagedRefusals: refusals.some(
			(refusal) => refusal.reason === "managed-file-modified",
		),
		hasUnmanagedRefusals: refusals.some(
			(refusal) => refusal.reason === "unmanaged-file-exists",
		),
		hasUnmanagedRemovals: refusals.some(
			(refusal) =>
				refusal.reason === "unmanaged-file-exists" &&
				refusal.operation === "removal",
		),
	};
}

function descriptorMatchesArtifact(artifact: LockfileArtifact): boolean {
	if (artifact.base === undefined) return true;
	if (artifact.base.semanticsVersion !== SURFACE_MERGE_SEMANTICS_VERSION)
		return false;

	return artifact.kind === "surface" || artifact.base.mergeKind === "opaque";
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function conflictValuesEqual(left: unknown, right: unknown): boolean {
	if (left === right) return true;
	if (Array.isArray(left) && Array.isArray(right)) {
		if (left.length !== right.length) return false;
		return left.every((value, index) =>
			conflictValuesEqual(value, right[index]),
		);
	}

	if (!isRecord(left) || !isRecord(right)) return false;

	const leftKeys = Object.keys(left);
	const rightKeys = Object.keys(right);
	if (leftKeys.length !== rightKeys.length) return false;

	return leftKeys.every(
		(key) =>
			Object.hasOwn(right, key) && conflictValuesEqual(left[key], right[key]),
	);
}

function descriptorsCompatible(
	previous: LockfileArtifact,
	next: LockfileArtifact,
): boolean {
	if (!descriptorMatchesArtifact(previous) || !descriptorMatchesArtifact(next))
		return false;

	if (previous.kind !== next.kind) return false;

	const previousBase = previous.base;
	const nextBase = next.base;

	if (previousBase === undefined)
		return (
			nextBase === undefined ||
			(previous.kind === "surface" && nextBase.mergeKind !== "opaque")
		);

	if (previousBase.mergeKind === "opaque")
		return nextBase === undefined || nextBase.mergeKind === "opaque";

	return (
		nextBase !== undefined &&
		nextBase.mergeKind === previousBase.mergeKind &&
		nextBase.semanticsVersion === previousBase.semanticsVersion
	);
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

	const previousRoot = previous.modules[moduleId]?.root;
	const nextRoot = current.modules[moduleId]?.root;

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

export function isUserOwnedEnv(relativePath: string): boolean {
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

export function describeConflictValue(value: unknown): string {
	if (value === undefined) return "missing";

	const serialized = JSON.stringify(value);
	if (serialized === undefined) return String(value);

	return serialized.length <= 120
		? serialized
		: `${serialized.slice(0, 117)}...`;
}

function conflictMessage(conflicts: ReadonlyArray<ApplyConflict>): string {
	const lines = conflicts.map(
		(conflict) =>
			`${conflict.label}: base was ${describeConflictValue(conflict.base)}, user has ${describeConflictValue(conflict.user)}, and forge wants ${describeConflictValue(conflict.forge)}.`,
	);

	return `Semantic merge conflicts were found:\n${lines.join("\n")}\nResolve each conflict, then run Forge again.`;
}

function refusalSentence(refusal: ApplyRefusal): string {
	return refusal.reason === "managed-file-modified"
		? `${refusal.path} was modified after Forge last managed it.`
		: `${refusal.path} already exists and is not managed by Forge.`;
}

function preflightMessage(
	refusals: ReadonlyArray<ApplyRefusal>,
	conflicts: ReadonlyArray<ApplyConflict>,
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

export function formatApplyError(
	error: ApplyError,
	options: FormatApplyErrorOptions = {},
): string {
	let report: string;
	let classification = error.preflight;

	if (
		error.reason === "managed-file-modified" ||
		error.reason === "unmanaged-file-exists"
	) {
		const refusal: ApplyRefusal = {
			reason: error.reason,
			operation:
				classification?.hasManagedRemovals === true ||
				classification?.hasUnmanagedRemovals === true
					? "removal"
					: "write",
			path: error.path,
			resolvable: false,
		};

		classification ??= classifyPreflight([refusal], []);
		report = preflightMessage([refusal], []);
	} else report = error.message;

	if (classification === undefined) return report;
	if (
		!classification.hasConflicts &&
		!classification.hasManagedRefusals &&
		!classification.hasUnmanagedRefusals
	)
		return report;
	if (options.includeResolutionGuidance === false) return report;

	const guidance: string[] = [];
	if (
		(classification.hasConflicts || classification.hasManagedRefusals) &&
		!classification.hasManagedRemovals
	)
		guidance.push(
			"Run again with --keep-user to keep your edits, or --accept-forge to take Forge's changes.",
		);

	if (classification.hasManagedRemovals)
		guidance.push(
			"Run again with --accept-forge to remove modified managed files that Forge no longer plans.",
		);

	if (classification.hasUnmanagedRefusals)
		guidance.push(
			classification.hasUnmanagedRemovals
				? "--keep-user cannot resolve unmanaged files; use --accept-forge to remove files Forge no longer plans."
				: "--keep-user cannot resolve unmanaged files; use --accept-forge to overwrite and manage them.",
		);

	return `${report}\n${guidance.join("\n")}`;
}

function formatMergedJson(
	path: string,
	value: Record<string, unknown>,
): string {
	const sorted = path.endsWith("package.json") ? sortPackageJson(value) : value;
	return formatJson(sorted, { compact: !path.endsWith("package.json") });
}

const makeApply = Effect.gen(function* () {
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
				reason: "path-escapes-project-root",
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
					reason: "path-escapes-project-root",
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
			(cause) =>
				new ApplyError({
					path: "content",
					reason: "content-hash-failed",
					cause,
				}),
		);
	});

	const readFile = Effect.fn("Apply.readFile")(function* (
		path: string,
		label: string,
	) {
		return yield* fs.readFileString(path).pipe(
			Effect.mapError(
				(cause) =>
					new ApplyError({
						path: label,
						reason: "file-read-failed",
						cause,
					}),
			),
		);
	});

	const pathExists = Effect.fn("Apply.pathExists")(function* (
		path: string,
		label: string,
	) {
		return yield* fs.exists(path).pipe(
			Effect.mapError(
				(cause) =>
					new ApplyError({
						path: label,
						reason: "file-read-failed",
						cause,
					}),
			),
		);
	});

	const parseJsonObject = Effect.fn("Apply.parseJsonObject")(function* (
		content: string,
		path: string,
		reason: "managed-file-modified" | "json-parse-failed" = "json-parse-failed",
	) {
		return yield* Effect.try({
			try: () => {
				const parsed: unknown = JSON.parse(content);
				if (!isJsonObject(parsed)) throw new Error("Expected a JSON object");
				return parsed;
			},
			catch: (cause) =>
				new ApplyError({
					path,
					reason,
					cause,
				}),
		});
	});

	const readBase = Effect.fn("Apply.readBase")(function* (
		projectRoot: string,
		artifact: LockfileArtifact,
		base: ArtifactBase,
	) {
		return yield* State.readBase(projectRoot, base.hash).pipe(
			Effect.mapError(
				(cause) =>
					new ApplyError({
						path: artifact.path,
						reason: "managed-base-read-failed",
						cause,
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
		resolution?: MergeConflictResolution,
		resolveConflict?: (label: string) => MergeConflictResolution | undefined,
	) {
		if (kind === "env")
			return threeWayMergeEnv(
				base,
				current,
				incoming,
				resolution,
				resolveConflict,
			);

		if (kind === "lines")
			return threeWayMergeSections(
				base,
				current,
				incoming,
				resolution,
				resolveConflict,
			);

		const baseJson = yield* parseJsonObject(base, path);
		const currentJson = yield* parseJsonObject(
			current,
			path,
			"managed-file-modified",
		);

		const incomingJson = yield* parseJsonObject(incoming, path);

		const result = threeWayMergeJson(baseJson, currentJson, incomingJson, {
			resolution,
			preserveDependencyRemovals: path.endsWith("package.json"),
			resolveConflict: (conflict) =>
				resolveConflict?.(formatJsonPath(conflict)),
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
			"managed-file-modified",
		);

		const residue = jsonResidue(baseJson, currentJson);
		return Object.keys(residue).length === 0
			? ""
			: formatMergedJson(path, residue);
	});

	const applyPlan = Effect.fn("Apply.applyPlan")(function* (
		projectRoot: string,
		plan: ApplyPlan,
		options: ApplyOptions = {},
	) {
		const resolutionPolicy = options.resolutionPolicy ?? "refuse";
		const mergeResolution =
			resolutionPolicy === "refuse"
				? undefined
				: resolutionPolicy === "keep-user"
					? "user"
					: "forge";

		const requestedResolutions = new Map(
			Object.entries(options.conflictResolutions ?? {}),
		);

		const consumedResolutionLabels = new Set<string>();
		const resolutionFor = (label: string, conflict?: ApplyConflict) => {
			const request = requestedResolutions.get(label);
			if (request === undefined) return mergeResolution;

			consumedResolutionLabels.add(label);
			if (
				conflict !== undefined &&
				"expected" in request &&
				(!conflictValuesEqual(request.expected.user, conflict.user) ||
					!conflictValuesEqual(request.expected.forge, conflict.forge))
			)
				return undefined;

			return request.resolution;
		};

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

		const conflicts: ApplyConflict[] = [];
		const refusals: ApplyRefusal[] = [];

		for (const relativePath of plan.removals) {
			const fullPath = yield* ensureContained(projectRoot, relativePath);
			if (isUserOwnedEnv(relativePath)) continue;
			if (!(yield* pathExists(fullPath, relativePath))) continue;

			const previousArtifact = previousArtifacts.get(relativePath);
			if (previousArtifact === undefined) {
				if (resolutionPolicy === "accept-forge") {
					removalsToApply.push(relativePath);
					continue;
				}

				refusals.push({
					path: relativePath,
					reason: "unmanaged-file-exists",
					operation: "removal",
					resolvable: false,
				});

				continue;
			}

			if (!descriptorMatchesArtifact(previousArtifact)) {
				refusals.push({
					path: relativePath,
					reason: "managed-file-modified",
					operation: "removal",
					resolvable: false,
				});

				continue;
			}

			const currentContent = yield* readFile(fullPath, relativePath);
			const currentHash = yield* hashContent(currentContent);

			const fileResolution = resolutionFor(relativePath);
			if (previousArtifact.base?.origin === "adopted") {
				if (fileResolution === "forge") removalsToApply.push(relativePath);
				else
					refusals.push({
						path: relativePath,
						reason: "managed-file-modified",
						operation: "removal",
						resolvable: false,
					});

				continue;
			}

			if (
				currentHash === previousArtifact.hash &&
				(previousArtifact.base === undefined ||
					previousArtifact.base.hash === currentHash)
			) {
				removalsToApply.push(relativePath);
				continue;
			}

			if (fileResolution === "forge") {
				removalsToApply.push(relativePath);
				continue;
			}

			if (resolutionPolicy === "keep-user") {
				refusals.push({
					path: relativePath,
					reason: "managed-file-modified",
					operation: "removal",
					resolvable: false,
				});

				continue;
			}

			const baseDescriptor = previousArtifact.base;
			if (
				baseDescriptor === undefined ||
				baseDescriptor.mergeKind === "opaque"
			) {
				refusals.push({
					path: relativePath,
					reason: "managed-file-modified",
					operation: "removal",
					resolvable: false,
				});

				continue;
			}

			const base = yield* readBase(
				projectRoot,
				previousArtifact,
				baseDescriptor,
			);
			const residueResult = yield* Effect.result(
				surfaceResidue(
					baseDescriptor.mergeKind,
					relativePath,
					base,
					currentContent,
				),
			);

			if (Result.isFailure(residueResult)) {
				if (residueResult.failure.reason !== "managed-file-modified")
					return yield* residueResult.failure;

				refusals.push({
					path: relativePath,
					reason: "managed-file-modified",
					operation: "removal",
					resolvable: false,
				});

				continue;
			}

			const residue = residueResult.success;
			if (residue === "") removalsToApply.push(relativePath);
			else
				writesToApply.push({
					content: residue,
					path: relativePath,
				});
		}

		const policyReadHashes = new Map<string, string>();
		for (const file of plan.writes) {
			const fullPath = yield* ensureContained(projectRoot, file.path);
			if (!(yield* pathExists(fullPath, file.path))) {
				writesToApply.push(file);
				continue;
			}

			if (isUserOwnedEnv(file.path)) {
				for (const [artifactId, artifact] of Object.entries(committedArtifacts))
					if (artifact.path === file.path)
						delete committedArtifacts[artifactId];

				continue;
			}

			const currentContent = yield* readFile(fullPath, file.path);

			const currentHash = yield* hashContent(currentContent);
			const nextHash = yield* hashContent(file.content);

			const fileResolution = resolutionFor(file.path);

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
			const isModuleMarker = /^module:[^:]+:file:forge\.json$/.test(
				file.artifactId ?? "",
			);

			const previousBase = managedArtifact?.base;
			const nextBase = nextArtifact?.base;
			const descriptorsAreCompatible =
				managedArtifact === undefined
					? nextArtifact === undefined ||
						descriptorMatchesArtifact(nextArtifact)
					: nextArtifact === undefined
						? descriptorMatchesArtifact(managedArtifact)
						: descriptorsCompatible(managedArtifact, nextArtifact);

			const canRebaseCurrentContent =
				file.artifactId !== undefined &&
				nextArtifact !== undefined &&
				descriptorsAreCompatible;

			const adoptMatchingContent = (candidateHash: string) => {
				if (currentHash !== candidateHash || !descriptorsAreCompatible)
					return false;

				if (file.artifactId !== undefined && nextArtifact !== undefined)
					committedArtifacts[file.artifactId] = {
						...nextArtifact,
						hash: candidateHash,
					};

				return true;
			};

			const rebaseCurrentContent = (base: ArtifactBase) => {
				if (!canRebaseCurrentContent) return false;

				committedArtifacts[file.artifactId] = {
					...nextArtifact,
					base,
					hash: currentHash,
				};

				policyReadHashes.set(file.path, currentHash);

				return true;
			};

			if (adoptMatchingContent(nextHash)) continue;
			if (managedArtifact === undefined) {
				if (resolutionPolicy === "accept-forge") {
					writesToApply.push(file);
					continue;
				}

				refusals.push({
					path: file.path,
					reason: "unmanaged-file-exists",
					operation: "write",
					resolvable: false,
				});

				continue;
			}

			if (isModuleMarker) {
				writesToApply.push(file);
				continue;
			}

			if (!descriptorsAreCompatible) {
				refusals.push({
					path: file.path,
					reason: "managed-file-modified",
					operation: "write",
					resolvable: false,
				});

				continue;
			}

			if (
				resolutionPolicy !== "accept-forge" &&
				currentHash === managedArtifact.hash &&
				previousBase !== undefined &&
				previousBase.hash === nextHash
			) {
				const storedBase = yield* readBase(
					projectRoot,
					managedArtifact,
					previousBase,
				);
				if (storedBase === file.content) {
					if (file.artifactId !== undefined && nextArtifact !== undefined)
						committedArtifacts[file.artifactId] = {
							...nextArtifact,
							base: previousBase,
							hash: currentHash,
						};

					continue;
				}
			}

			const currentIsPureRender =
				managedArtifact.base === undefined ||
				managedArtifact.base.hash === currentHash;

			if (
				currentHash === managedArtifact.hash &&
				currentIsPureRender &&
				previousBase?.origin !== "adopted"
			) {
				writesToApply.push(file);
				continue;
			}

			if (previousBase?.mergeKind === "opaque") {
				if (fileResolution === "forge") {
					writesToApply.push(file);
					continue;
				}

				const declinedBase = {
					hash: nextHash,
					mergeKind: "opaque",
					semanticsVersion: SURFACE_MERGE_SEMANTICS_VERSION,
				} satisfies ArtifactBase;

				if (fileResolution === "user" && rebaseCurrentContent(declinedBase))
					continue;

				refusals.push({
					path: file.path,
					reason: "managed-file-modified",
					operation: "write",
					resolvable: canRebaseCurrentContent,
				});

				continue;
			}

			if (previousBase === undefined || nextBase === undefined) {
				if (fileResolution === "forge") {
					writesToApply.push(file);
					continue;
				}

				const declinedBase =
					nextBase ??
					({
						hash: nextHash,
						mergeKind: "opaque",
						semanticsVersion: SURFACE_MERGE_SEMANTICS_VERSION,
					} satisfies ArtifactBase);

				if (fileResolution === "user" && rebaseCurrentContent(declinedBase))
					continue;

				refusals.push({
					path: file.path,
					reason: "managed-file-modified",
					operation: "write",
					resolvable: canRebaseCurrentContent,
				});

				continue;
			}

			const base = yield* readBase(projectRoot, managedArtifact, previousBase);
			const mergeBase =
				previousBase.origin === "adopted"
					? previousBase.mergeKind === "json"
						? "{}\n"
						: ""
					: base;

			const mergedResult = yield* Effect.result(
				mergeSurface(
					previousBase.mergeKind,
					file.path,
					mergeBase,
					currentContent,
					file.content,
					mergeResolution,
					(label) => resolutionFor(`${file.path} -> ${label}`),
				),
			);

			if (Result.isFailure(mergedResult)) {
				if (mergedResult.failure.reason !== "managed-file-modified")
					return yield* mergedResult.failure;

				if (fileResolution === "forge") {
					writesToApply.push(file);
					continue;
				}

				if (fileResolution === "user" && rebaseCurrentContent(nextBase))
					continue;

				refusals.push({
					path: file.path,
					reason: "managed-file-modified",
					operation: "write",
					resolvable: canRebaseCurrentContent,
				});

				continue;
			}

			const merged = mergedResult.success;
			const discoveredConflicts: ApplyConflict[] = [];

			if ("json" in merged)
				for (const conflict of merged.conflicts)
					discoveredConflicts.push({
						base: valueAtPath(merged.json.base, conflict),
						forge: valueAtPath(merged.json.incoming, conflict),
						label: `${file.path} -> ${formatJsonPath(conflict)}`,
						user: valueAtPath(merged.json.current, conflict),
					});
			else
				for (const [index, conflict] of merged.conflicts.entries()) {
					const values = merged.conflictValues?.[index];
					discoveredConflicts.push({
						base: values?.base,
						forge: values?.forge,
						label: `${file.path} -> ${conflict}`,
						user: values?.user,
					});
				}

			const unresolvedConflicts = discoveredConflicts.filter(
				(conflict) => resolutionFor(conflict.label, conflict) === undefined,
			);

			conflicts.push(...unresolvedConflicts);
			const conflictsResolved =
				discoveredConflicts.length > 0 && unresolvedConflicts.length === 0;

			if (merged.conflicts.length === 0 || conflictsResolved) {
				if (mergeResolution !== undefined || conflictsResolved)
					policyReadHashes.set(file.path, currentHash);

				const mergedWrite = { ...file, content: merged.merged };

				const mergedHash = yield* hashContent(merged.merged);
				if (mergedHash !== currentHash) writesToApply.push(mergedWrite);

				if (file.artifactId !== undefined && nextArtifact !== undefined)
					committedArtifacts[file.artifactId] = {
						...nextArtifact,
						hash: mergedHash,
					};
			}
		}

		for (const label of requestedResolutions.keys())
			if (!consumedResolutionLabels.has(label))
				return yield* new ApplyError({
					path: label,
					reason: "resolution-label-unknown",
					detail: `Resolution Label Unknown: ${label}`,
				});

		const preflight = classifyPreflight(refusals, conflicts);
		const refusal = refusals.length === 1 ? refusals[0] : undefined;

		if (refusal !== undefined && conflicts.length === 0)
			return yield* new ApplyError({
				path: refusal.path,
				reason: refusal.reason,
				preflight,
			});

		if (refusals.length > 0 || conflicts.length > 0)
			return yield* new ApplyError({
				path: refusals.length === 0 ? "managed surfaces" : "managed files",
				reason: "preflight-failed",
				detail: preflightMessage(refusals, conflicts),
				preflight,
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

		for (const [artifactId, content] of Object.entries(plan.baseContents ?? {}))
			pureWritesById.set(artifactId, content);

		const bases = new Map<string, string>();
		for (const [artifactId, artifact] of Object.entries(
			committedLockfile.artifacts,
		)) {
			if (artifact.base === undefined) continue;
			if (!descriptorMatchesArtifact(artifact) || isUserOwnedEnv(artifact.path))
				return yield* new ApplyError({
					path: artifact.path,
					reason: "managed-base-forbidden",
				});

			const content = pureWritesById.get(artifactId);
			if (content === undefined)
				return yield* new ApplyError({
					path: artifact.path,
					reason: "managed-base-content-missing",
				});

			if ((yield* hashContent(content)) !== artifact.base.hash)
				return yield* new ApplyError({
					path: artifact.path,
					reason: "managed-base-hash-mismatch",
				});

			bases.set(artifact.base.hash, content);
		}

		const validateExistingBases = Effect.fn("Apply.validateExistingBases")(
			function* () {
				for (const hash of bases.keys()) {
					const baseRelative = `.forge/bases/${hash}`;
					const destination = yield* ensureContained(projectRoot, baseRelative);

					if (!(yield* pathExists(destination, baseRelative))) continue;

					const existing = yield* readFile(destination, baseRelative);
					if ((yield* hashContent(existing)) !== hash)
						return yield* new ApplyError({
							path: baseRelative,
							reason: "managed-base-hash-mismatch",
						});
				}
			},
		);

		const revalidatePolicyInputs = Effect.fn("Apply.revalidatePolicyInputs")(
			function* () {
				for (const [relativePath, expectedHash] of policyReadHashes) {
					const fullPath = yield* ensureContained(projectRoot, relativePath);
					const exists = yield* pathExists(fullPath, relativePath);
					const currentHash = exists
						? yield* readFile(fullPath, relativePath).pipe(
								Effect.flatMap(hashContent),
							)
						: undefined;

					if (currentHash === expectedHash) continue;
					return yield* new ApplyError({
						path: relativePath,
						reason: "managed-file-modified",
						preflight: {
							hasConflicts: false,
							hasManagedRemovals: false,
							hasManagedRefusals: true,
							hasUnmanagedRefusals: false,
							hasUnmanagedRemovals: false,
						},
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
			Effect.mapError(
				(cause) =>
					new ApplyError({
						path: stagingRootRelative,
						reason: "staging-directory-failed",
						cause,
					}),
			),
		);

		const stagingDirectory = yield* fs
			.makeTempDirectory({ directory: stagingRoot, prefix: ".staging-" })
			.pipe(
				Effect.mapError(
					(cause) =>
						new ApplyError({
							path: stagingRootRelative,
							reason: "staging-directory-failed",
							cause,
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
				Effect.mapError(
					(cause) =>
						new ApplyError({
							path: stagedRelative,
							reason: "staged-directory-write-failed",
							cause,
						}),
				),
			);

			yield* fs.writeFileString(stagedPath, content).pipe(
				Effect.mapError(
					(cause) =>
						new ApplyError({
							path: stagedRelative,
							reason: "staged-file-write-failed",
							cause,
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
			yield* revalidatePolicyInputs();
			const stateBundlePath = yield* ensureContained(
				projectRoot,
				".forge/state.json",
			);

			if (!(yield* pathExists(stateBundlePath, ".forge/state.json")))
				yield* fs.rename(stagedPreviousStateBundle, stateBundlePath).pipe(
					Effect.mapError(
						(cause) =>
							new ApplyError({
								path: ".forge/state.json",
								reason: "atomic-state-backup-failed",
								cause,
							}),
					),
				);

			for (const relativePath of removalsToApply) {
				const fullPath = yield* ensureContained(projectRoot, relativePath);
				if (!(yield* pathExists(fullPath, relativePath))) continue;

				yield* fs.remove(fullPath).pipe(
					Effect.mapError(
						(cause) =>
							new ApplyError({
								path: relativePath,
								reason: "file-remove-failed",
								cause,
							}),
					),
				);
			}

			for (const staged of stagedWrites) {
				const fullPath = yield* ensureContained(projectRoot, staged.path);
				yield* fs.makeDirectory(dirname(fullPath), { recursive: true }).pipe(
					Effect.mapError(
						(cause) =>
							new ApplyError({
								path: staged.path,
								reason: "directory-write-failed",
								cause,
							}),
					),
				);

				yield* fs.rename(staged.stagedPath, fullPath).pipe(
					Effect.mapError(
						(cause) =>
							new ApplyError({
								path: staged.path,
								reason: "atomic-file-write-failed",
								cause,
							}),
					),
				);
			}

			const basesDirectory = yield* ensureContained(
				projectRoot,
				".forge/bases",
			);

			yield* fs.makeDirectory(basesDirectory, { recursive: true }).pipe(
				Effect.mapError(
					(cause) =>
						new ApplyError({
							path: ".forge/bases",
							reason: "base-directory-failed",
							cause,
						}),
				),
			);

			for (const staged of stagedBases) {
				const baseRelative = `.forge/bases/${staged.hash}`;
				const destination = yield* ensureContained(projectRoot, baseRelative);
				if (yield* pathExists(destination, baseRelative)) continue;

				yield* fs.rename(staged.stagedPath, destination).pipe(
					Effect.mapError(
						(cause) =>
							new ApplyError({
								path: baseRelative,
								reason: "atomic-base-write-failed",
								cause,
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
					(cause) =>
						new ApplyError({
							path: ".forge/manifest.json",
							reason: "atomic-manifest-write-failed",
							cause,
						}),
				),
			);

			yield* fs.rename(stagedLockfile, lockfilePath).pipe(
				Effect.mapError(
					(cause) =>
						new ApplyError({
							path: ".forge/lock.json",
							reason: "atomic-lockfile-write-failed",
							cause,
						}),
				),
			);

			yield* fs.remove(stateBundlePath).pipe(
				Effect.mapError(
					(cause) =>
						new ApplyError({
							path: ".forge/state.json",
							reason: "atomic-state-publish-failed",
							cause,
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
});

type ApplyService = Effect.Success<typeof makeApply>;

export class Apply extends Context.Service<Apply, ApplyService>()("Apply") {
	static readonly Default = Layer.effect(Apply, makeApply);
	static readonly applyPlan = (
		...args: Parameters<ApplyService["applyPlan"]>
	) => Apply.use((service) => service.applyPlan(...args));
}
