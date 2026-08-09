import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { NodeServices } from "@effect/platform-node";
import { Effect, FileSystem, Layer, PlatformError, Schema } from "effect";
import { describe, expect, it, vi } from "vitest";
import {
	Apply,
	ApplyError,
	ApplyErrors,
	type ApplyPlan,
	formatApplyError,
	type LockfileArtifact,
	State,
} from "../src/index";
import { hashContent, withTempDir, writeText } from "./harness";

const nodeLayer = NodeServices.layer;
const coreLayer = Layer.mergeAll(Apply.Default, State.Default).pipe(
	Layer.provide(nodeLayer),
);

function systemFailure(method: string, path: string) {
	return Effect.fail(
		PlatformError.systemError({
			method,
			module: "FileSystem",
			pathOrDescriptor: path,
			_tag: "PermissionDenied",
		}),
	);
}

function applyLayerWithFileSystem(
	transform: (fileSystem: FileSystem.FileSystem) => FileSystem.FileSystem,
) {
	const fileSystemLayer = Layer.effect(
		FileSystem.FileSystem,
		Effect.map(FileSystem.FileSystem, transform),
	).pipe(Layer.provide(nodeLayer));
	return Layer.mergeAll(Apply.Default, State.Default).pipe(
		Layer.provide(fileSystemLayer),
	);
}

function emptyPlan(writes: ApplyPlan["writes"] = []): ApplyPlan {
	return {
		lockfile: { artifacts: {} },
		manifest: { config: {}, installs: [], modules: {} },
		removals: [],
		writes,
	};
}

function surfaceArtifact(
	path: string,
	hash: string,
	mergeKind: "env" | "json" | "lines",
): LockfileArtifact {
	return {
		base: { hash, mergeKind, semanticsVersion: 1 },
		definitionIds: ["fixture"],
		hash,
		kind: "surface",
		path,
	};
}

type CommitFailurePoint =
	| "atomic-file"
	| "backup"
	| "base-directory"
	| "destination-directory"
	| "file-remove"
	| "lockfile"
	| "manifest"
	| "publish"
	| "staged-directory"
	| "staged-write"
	| "staging-root"
	| "staging-temp";

const commitFailures: ReadonlyArray<{
	readonly message: string;
	readonly path: string;
	readonly point: CommitFailurePoint;
}> = [
	{
		message: "Staging Directory Failed",
		path: ".forge",
		point: "staging-root",
	},
	{
		message: "Staging Directory Failed",
		path: ".forge",
		point: "staging-temp",
	},
	{
		message: "Staged Directory Write Failed",
		path: ".forge/.staging-",
		point: "staged-directory",
	},
	{
		message: "Staged File Write Failed",
		path: ".forge/.staging-",
		point: "staged-write",
	},
	{
		message: "Atomic State Backup Failed",
		path: ".forge/state.json",
		point: "backup",
	},
	{ message: "File Remove Failed", path: "old.txt", point: "file-remove" },
	{
		message: "Directory Write Failed",
		path: "nested/new.txt",
		point: "destination-directory",
	},
	{
		message: "Atomic File Write Failed",
		path: "nested/new.txt",
		point: "atomic-file",
	},
	{
		message: "Base Directory Failed",
		path: ".forge/bases",
		point: "base-directory",
	},
	{
		message: "Atomic Manifest Write Failed",
		path: ".forge/manifest.json",
		point: "manifest",
	},
	{
		message: "Atomic Lockfile Write Failed",
		path: ".forge/lock.json",
		point: "lockfile",
	},
	{
		message: "Atomic State Publish Failed",
		path: ".forge/state.json",
		point: "publish",
	},
];

describe("apply edge coverage", () => {
	it.each(commitFailures)(
		"maps $point filesystem failures to $message",
		async ({ message, path, point }) => {
			await withTempDir(`apply-${point}`, async (directory) => {
				const oldContent = "old\n";
				await writeText(join(directory, "old.txt"), oldContent);
				await Effect.runPromise(
					State.writeLockfile(directory, {
						artifacts: {
							old: {
								definitionIds: ["fixture"],
								hash: await hashContent(oldContent),
								kind: "file",
								path: "old.txt",
							},
						},
					}).pipe(Effect.provide(coreLayer)),
				);

				const failingLayer = applyLayerWithFileSystem((fileSystem) => ({
					...fileSystem,
					makeDirectory: (target, options) => {
						if (point === "staging-root" && target.endsWith("/.forge"))
							return systemFailure("makeDirectory", target);
						if (
							point === "staged-directory" &&
							target.includes("/.forge/.staging-")
						)
							return systemFailure("makeDirectory", target);
						if (
							point === "destination-directory" &&
							target.endsWith("/nested") &&
							!target.includes("/.staging-")
						)
							return systemFailure("makeDirectory", target);
						if (point === "base-directory" && target.endsWith("/.forge/bases"))
							return systemFailure("makeDirectory", target);
						return fileSystem.makeDirectory(target, options);
					},
					makeTempDirectory: (options) =>
						point === "staging-temp"
							? systemFailure("makeTempDirectory", directory)
							: fileSystem.makeTempDirectory(options),
					remove: (target, options) => {
						if (point === "file-remove" && target.endsWith("/old.txt"))
							return systemFailure("remove", target);
						if (point === "publish" && target.endsWith("/.forge/state.json"))
							return systemFailure("remove", target);
						return fileSystem.remove(target, options);
					},
					rename: (oldPath, newPath) => {
						if (point === "backup" && newPath.endsWith("/.forge/state.json"))
							return systemFailure("rename", newPath);
						if (
							point === "atomic-file" &&
							oldPath.includes("/.staging-") &&
							newPath.endsWith("/nested/new.txt")
						)
							return systemFailure("rename", newPath);
						if (
							point === "manifest" &&
							newPath.endsWith("/.forge/manifest.json")
						)
							return systemFailure("rename", newPath);
						if (point === "lockfile" && newPath.endsWith("/.forge/lock.json"))
							return systemFailure("rename", newPath);
						return fileSystem.rename(oldPath, newPath);
					},
					writeFileString: (target, content, options) =>
						point === "staged-write" && target.includes("/.forge/.staging-")
							? systemFailure("writeFileString", target)
							: fileSystem.writeFileString(target, content, options),
				}));
				const error = await Effect.runPromise(
					Effect.flip(
						Apply.applyPlan(directory, {
							...emptyPlan([{ content: "new\n", path: "nested/new.txt" }]),
							removals: ["old.txt"],
						}).pipe(Effect.provide(failingLayer)),
					),
				);

				expect(error.message).toBe(message);
				if (!(error instanceof ApplyError))
					throw new Error("Expected ApplyError");
				expect(Schema.is(ApplyErrors)(error)).toBe(true);
				if (path === ".forge/.staging-") expect(error.path).toContain(path);
				else expect(error.path).toBe(path);
			});
		},
	);

	it("maps atomic base publication failures", async () => {
		await withTempDir("apply-atomic-base", async (directory) => {
			const content = "# Managed\ndist/\n";
			const hash = await hashContent(content);
			const artifactId = "project:surface:gitignore";
			const failingLayer = applyLayerWithFileSystem((fileSystem) => ({
				...fileSystem,
				rename: (oldPath, newPath) =>
					newPath.endsWith(`/.forge/bases/${hash}`)
						? systemFailure("rename", newPath)
						: fileSystem.rename(oldPath, newPath),
			}));
			const error = await Effect.runPromise(
				Effect.flip(
					Apply.applyPlan(directory, {
						lockfile: {
							artifacts: {
								[artifactId]: surfaceArtifact(".gitignore", hash, "lines"),
							},
						},
						manifest: { config: {}, installs: [], modules: {} },
						removals: [],
						writes: [{ artifactId, content, path: ".gitignore" }],
					}).pipe(Effect.provide(failingLayer)),
				),
			);

			expect(error).toMatchObject({
				message: "Atomic Base Write Failed",
				path: `.forge/bases/${hash}`,
			});
		});
	});

	it("ignores staging cleanup failures after a successful commit", async () => {
		await withTempDir("apply-cleanup-failure", async (directory) => {
			const cleanupFailingLayer = applyLayerWithFileSystem((fileSystem) => ({
				...fileSystem,
				remove: (path, options) =>
					path.includes("/.forge/.staging-")
						? systemFailure("remove", path)
						: fileSystem.remove(path, options),
			}));

			await Effect.runPromise(
				Apply.applyPlan(
					directory,
					emptyPlan([{ content: "committed\n", path: "committed.txt" }]),
				).pipe(Effect.provide(cleanupFailingLayer)),
			);
			expect(await readFile(join(directory, "committed.txt"), "utf-8")).toBe(
				"committed\n",
			);
		});
	});

	it("rejects a staging directory returned outside the project", async () => {
		await withTempDir("apply-staging-outside", async (scratch) => {
			const projectRoot = join(scratch, "project");
			const outside = join(scratch, "outside-stage");
			await mkdir(projectRoot, { recursive: true });
			const outsideLayer = applyLayerWithFileSystem((fileSystem) => ({
				...fileSystem,
				makeTempDirectory: () => Effect.succeed(outside),
			}));
			const error = await Effect.runPromise(
				Effect.flip(
					Apply.applyPlan(
						projectRoot,
						emptyPlan([{ content: "nope\n", path: "file.txt" }]),
					).pipe(Effect.provide(outsideLayer)),
				),
			);

			expect(error).toMatchObject({
				message: "Path Escapes Project Root",
				path: "../outside-stage",
			});
		});
	});

	it("rechecks staged child containment after staging setup", async () => {
		await withTempDir("apply-staged-race", async (scratch) => {
			const projectRoot = join(scratch, "project");
			const outside = join(scratch, "outside-stage");
			await mkdir(projectRoot, { recursive: true });
			let stagingDirectory: string | undefined;
			let stagingRealPaths = 0;
			const racingLayer = applyLayerWithFileSystem((fileSystem) => ({
				...fileSystem,
				makeTempDirectory: (options) =>
					fileSystem.makeTempDirectory(options).pipe(
						Effect.tap((path) =>
							Effect.sync(() => {
								stagingDirectory = path;
							}),
						),
					),
				realPath: (path) => {
					if (path === stagingDirectory) {
						stagingRealPaths++;
						if (stagingRealPaths > 1) return Effect.succeed(outside);
					}
					return fileSystem.realPath(path);
				},
			}));
			const error = await Effect.runPromise(
				Effect.flip(
					Apply.applyPlan(
						projectRoot,
						emptyPlan([{ content: "nope\n", path: "file.txt" }]),
					).pipe(Effect.provide(racingLayer)),
				),
			);

			expect(error.message).toBe("Path Escapes Project Root");
			if (!(error instanceof ApplyError))
				throw new Error("Expected ApplyError");
			expect(error.path).toContain(".forge/.staging-");
			expect(error.path).toContain("/files/file.txt");
		});
	});

	it("maps managed base read and content-integrity failures", async () => {
		const modes: ReadonlyArray<"mismatch" | "missing"> = [
			"missing",
			"mismatch",
		];
		for (const mode of modes) {
			await withTempDir(`apply-base-${mode}`, async (directory) => {
				const path = "surface.json";
				const base = '{"managed":"base"}\n';
				const current = '{"managed":"user"}\n';
				const incoming = '{"managed":"forge"}\n';
				const baseHash = await hashContent(base);
				const incomingHash = await hashContent(incoming);
				await writeText(join(directory, path), current);
				await Effect.runPromise(
					State.writeLockfile(directory, {
						artifacts: { surface: surfaceArtifact(path, baseHash, "json") },
					}).pipe(Effect.provide(coreLayer)),
				);
				if (mode === "mismatch")
					await writeText(
						join(directory, ".forge/bases", baseHash),
						"corrupt\n",
					);

				const error = await Effect.runPromise(
					Effect.flip(
						Apply.applyPlan(directory, {
							lockfile: {
								artifacts: {
									surface: surfaceArtifact(path, incomingHash, "json"),
								},
							},
							manifest: { config: {}, installs: [], modules: {} },
							removals: [],
							writes: [{ artifactId: "surface", content: incoming, path }],
						}).pipe(Effect.provide(coreLayer)),
					),
				);

				expect(error).toMatchObject({
					message: "Managed Base Read Failed",
					path,
				});
			});
		}
	});

	it("validates that every declared base has matching pure content", async () => {
		await withTempDir("apply-base-preflight", async (directory) => {
			const content = "# Managed\n";
			const hash = await hashContent(content);
			const artifact = surfaceArtifact(".gitignore", hash, "lines");
			const missing = await Effect.runPromise(
				Effect.flip(
					Apply.applyPlan(directory, {
						...emptyPlan(),
						lockfile: { artifacts: { surface: artifact } },
					}).pipe(Effect.provide(coreLayer)),
				),
			);
			expect(missing).toMatchObject({
				message: "Managed Base Content Missing",
				path: ".gitignore",
			});

			const mismatch = await Effect.runPromise(
				Effect.flip(
					Apply.applyPlan(directory, {
						...emptyPlan([
							{
								artifactId: "surface",
								content: `${content}changed\n`,
								path: ".gitignore",
							},
						]),
						lockfile: { artifacts: { surface: artifact } },
					}).pipe(Effect.provide(coreLayer)),
				),
			);
			expect(mismatch).toMatchObject({
				message: "Managed Base Hash Mismatch",
				path: ".gitignore",
			});
		});
	});

	it("dispatches env and JSON residue handling on surface removal", async () => {
		await withTempDir("apply-removal-dispatch", async (directory) => {
			const emptyPath = "empty.json";
			const residuePath = "residue.json";
			const envPath = ".env.example";
			const jsonBase = '{"managed":true}\n';
			const envBase = "MANAGED=forge\n";
			const jsonHash = await hashContent(jsonBase);
			const envHash = await hashContent(envBase);
			await writeText(join(directory, emptyPath), '{ "managed": true }\n');
			await writeText(
				join(directory, residuePath),
				'{"managed":true,"user":"kept"}\n',
			);
			await writeText(join(directory, envPath), "MANAGED=forge\nUSER=kept\n");
			await Effect.runPromise(
				Effect.gen(function* () {
					yield* State.writeBase(directory, jsonHash, jsonBase);
					yield* State.writeBase(directory, envHash, envBase);
					yield* State.writeLockfile(directory, {
						artifacts: {
							empty: surfaceArtifact(emptyPath, jsonHash, "json"),
							env: surfaceArtifact(envPath, envHash, "env"),
							residue: surfaceArtifact(residuePath, jsonHash, "json"),
						},
					});
				}).pipe(Effect.provide(coreLayer)),
			);

			await Effect.runPromise(
				Apply.applyPlan(directory, {
					...emptyPlan(),
					removals: [emptyPath, residuePath, envPath],
				}).pipe(Effect.provide(coreLayer)),
			);
			await expect(
				readFile(join(directory, emptyPath), "utf-8"),
			).rejects.toThrow();
			expect(await readFile(join(directory, residuePath), "utf-8")).toBe(
				'{ "user": "kept" }\n',
			);
			expect(await readFile(join(directory, envPath), "utf-8")).toBe(
				"USER=kept\n",
			);
		});
	});

	it("distinguishes removal parse refusals from invalid managed bases", async () => {
		const modes: ReadonlyArray<"base" | "current"> = ["base", "current"];
		for (const mode of modes) {
			await withTempDir(`apply-removal-parse-${mode}`, async (directory) => {
				const path = "surface.json";
				const base = mode === "base" ? "[]\n" : "{}\n";
				const current = mode === "base" ? "{}\n" : "// user comment\n{}\n";
				const hash = await hashContent(base);
				await writeText(join(directory, path), current);
				await Effect.runPromise(
					Effect.gen(function* () {
						yield* State.writeBase(directory, hash, base);
						yield* State.writeLockfile(directory, {
							artifacts: { surface: surfaceArtifact(path, hash, "json") },
						});
					}).pipe(Effect.provide(coreLayer)),
				);

				const error = await Effect.runPromise(
					Effect.flip(
						Apply.applyPlan(directory, {
							...emptyPlan(),
							removals: [path],
						}).pipe(Effect.provide(coreLayer)),
					),
				);
				if (mode === "base")
					expect(error).toMatchObject({
						message: "Managed JSON Parse Failed",
						path,
					});
				else
					expect(error).toMatchObject({
						message: "Managed File Modified",
						path,
					});
			});
		}
	});

	it("propagates invalid incoming managed JSON instead of a modification refusal", async () => {
		await withTempDir("apply-invalid-incoming-json", async (directory) => {
			const path = "surface.json";
			const base = '{"managed":"base"}\n';
			const current = '{"managed":"user"}\n';
			const incoming = "[]\n";
			const baseHash = await hashContent(base);
			const incomingHash = await hashContent(incoming);
			await writeText(join(directory, path), current);
			await Effect.runPromise(
				Effect.gen(function* () {
					yield* State.writeBase(directory, baseHash, base);
					yield* State.writeLockfile(directory, {
						artifacts: { surface: surfaceArtifact(path, baseHash, "json") },
					});
				}).pipe(Effect.provide(coreLayer)),
			);

			const error = await Effect.runPromise(
				Effect.flip(
					Apply.applyPlan(directory, {
						lockfile: {
							artifacts: {
								surface: surfaceArtifact(path, incomingHash, "json"),
							},
						},
						manifest: { config: {}, installs: [], modules: {} },
						removals: [],
						writes: [{ artifactId: "surface", content: incoming, path }],
					}).pipe(Effect.provide(coreLayer)),
				),
			);
			expect(error).toMatchObject({
				message: "Managed JSON Parse Failed",
				path,
			});
		});
	});

	it("reports combined refusals and detailed JSON conflicts exactly", async () => {
		await withTempDir("apply-combined-preflight", async (directory) => {
			const path = "surface.json";
			const userLong = "u".repeat(130);
			const forgeLong = "f".repeat(130);
			const base = JSON.stringify({
				long: "base",
				normal: "base",
				"weird-key": "base",
			});
			const current = JSON.stringify({ long: userLong, "weird-key": "user" });
			const incoming = JSON.stringify({
				long: forgeLong,
				normal: "forge",
				"weird-key": "forge",
			});
			const baseHash = await hashContent(base);
			const incomingHash = await hashContent(incoming);
			await writeText(join(directory, path), current);
			await writeText(join(directory, "loose.txt"), "user-owned\n");
			await Effect.runPromise(
				Effect.gen(function* () {
					yield* State.writeBase(directory, baseHash, base);
					yield* State.writeLockfile(directory, {
						artifacts: { surface: surfaceArtifact(path, baseHash, "json") },
					});
				}).pipe(Effect.provide(coreLayer)),
			);

			const error = await Effect.runPromise(
				Effect.flip(
					Apply.applyPlan(directory, {
						lockfile: {
							artifacts: {
								surface: surfaceArtifact(path, incomingHash, "json"),
							},
						},
						manifest: { config: {}, installs: [], modules: {} },
						removals: ["loose.txt"],
						writes: [{ artifactId: "surface", content: incoming, path }],
					}).pipe(Effect.provide(coreLayer)),
				),
			);
			const shorten = (value: string) =>
				`${JSON.stringify(value).slice(0, 117)}...`;
			const expected = [
				"Forge cannot safely update these files:",
				"loose.txt already exists and is not managed by Forge.",
				"Semantic merge conflicts were found:",
				`surface.json -> long: base was "base", user has ${shorten(userLong)}, and forge wants ${shorten(forgeLong)}.`,
				'surface.json -> normal: base was "base", user has missing, and forge wants "forge".',
				'surface.json -> ["weird-key"]: base was "base", user has "user", and forge wants "forge".',
				"Resolve each conflict, then run Forge again.",
			].join("\n");

			expect(error).toMatchObject({ message: expected, path: "managed files" });
			expect(await readFile(join(directory, path), "utf-8")).toBe(current);
			expect(await readFile(join(directory, "loose.txt"), "utf-8")).toBe(
				"user-owned\n",
			);
		});
	});

	it("formats both refusal variants and ordinary apply errors", () => {
		expect(
			formatApplyError(
				new ApplyError({
					path: "loose.txt",
					reason: "unmanaged-file-exists",
				}),
			),
		).toBe(
			"Forge cannot safely update these files:\nloose.txt already exists and is not managed by Forge.\n--keep-user cannot resolve unmanaged files; use --accept-forge to overwrite and manage them.",
		);
		expect(
			formatApplyError(
				new ApplyError({ path: "file.txt", reason: "file-read-failed" }),
			),
		).toBe("File Read Failed");
		expect(
			formatApplyError(
				new ApplyError({
					path: "file.txt",
					reason: "file-read-failed",
					preflight: {
						hasConflicts: false,
						hasManagedRemovals: false,
						hasManagedRefusals: false,
						hasUnmanagedRefusals: false,
						hasUnmanagedRemovals: false,
					},
				}),
			),
		).toBe("File Read Failed");
	});

	it("does not infer guidance classes from user-controlled conflict text", async () => {
		await withTempDir("apply-structured-guidance", async (directory) => {
			const path = "surface.json";
			const base = '{"value":"base"}\n';
			const current =
				'{"value":"already exists and is not managed by Forge."}\n';
			const incoming = '{"value":"forge"}\n';
			const baseHash = await hashContent(base);
			const incomingHash = await hashContent(incoming);
			await writeText(join(directory, path), current);
			await Effect.runPromise(
				Effect.gen(function* () {
					yield* State.writeBase(directory, baseHash, base);
					yield* State.writeLockfile(directory, {
						artifacts: { surface: surfaceArtifact(path, baseHash, "json") },
					});
				}).pipe(Effect.provide(coreLayer)),
			);

			const error = await Effect.runPromise(
				Effect.flip(
					Apply.applyPlan(directory, {
						lockfile: {
							artifacts: {
								surface: surfaceArtifact(path, incomingHash, "json"),
							},
						},
						manifest: { config: {}, installs: [], modules: {} },
						removals: [],
						writes: [{ artifactId: "surface", content: incoming, path }],
					}).pipe(Effect.provide(coreLayer)),
				),
			);
			if (!(error instanceof ApplyError))
				throw new Error("Expected ApplyError");
			const formatted = formatApplyError(error);
			expect(formatted).toContain(
				"Run again with --keep-user to keep your edits, or --accept-forge to take Forge's changes.",
			);
			expect(formatted).not.toContain(
				"--keep-user cannot resolve unmanaged files",
			);
		});
	});

	it("aborts policy-resolved writes when a preflight input drifts", async () => {
		await withTempDir("apply-policy-drift", async (directory) => {
			const path = "surface.json";
			const artifactId = "surface";
			const base = '{"value":"base"}\n';
			const baseHash = await hashContent(base);
			const incoming = '{"value":"forge"}\n';
			const incomingHash = await hashContent(incoming);
			await Effect.runPromise(
				Apply.applyPlan(directory, {
					lockfile: {
						artifacts: {
							[artifactId]: surfaceArtifact(path, baseHash, "json"),
						},
					},
					manifest: { config: {}, installs: [], modules: {} },
					removals: [],
					writes: [{ artifactId, content: base, path }],
				}).pipe(Effect.provide(coreLayer)),
			);
			await writeText(join(directory, path), '{"value":"user"}\n');
			const lockBefore = await readFile(
				join(directory, ".forge/lock.json"),
				"utf-8",
			);
			let injected = false;
			const racingLayer = applyLayerWithFileSystem((fileSystem) => ({
				...fileSystem,
				writeFileString: (target, content, options) =>
					fileSystem.writeFileString(target, content, options).pipe(
						Effect.tap(() => {
							if (injected || !target.endsWith("/state/lock.json"))
								return Effect.void;
							injected = true;
							return fileSystem.writeFileString(
								join(directory, path),
								'{"value":"mid-run"}\n',
							);
						}),
					),
			}));

			const error = await Effect.runPromise(
				Effect.flip(
					Apply.applyPlan(
						directory,
						{
							lockfile: {
								artifacts: {
									[artifactId]: surfaceArtifact(path, incomingHash, "json"),
								},
							},
							manifest: {
								config: { changed: true },
								installs: [],
								modules: {},
							},
							removals: [],
							writes: [
								{ artifactId, content: incoming, path },
								{ content: "new\n", path: "new.txt" },
							],
						},
						{ resolutionPolicy: "keep-user" },
					).pipe(Effect.provide(racingLayer)),
				),
			);
			expect(error).toMatchObject({ message: "Managed File Modified", path });
			expect(await readFile(join(directory, path), "utf-8")).toBe(
				'{"value":"mid-run"}\n',
			);
			expect(await readFile(join(directory, ".forge/lock.json"), "utf-8")).toBe(
				lockBefore,
			);
			await expect(
				readFile(join(directory, "new.txt"), "utf-8"),
			).rejects.toThrow();
			await expect(
				readFile(join(directory, ".forge/bases", incomingHash), "utf-8"),
			).rejects.toThrow();
		});
	});

	it("aborts clean policy merges when a preflight input drifts", async () => {
		await withTempDir("apply-clean-policy-drift", async (directory) => {
			const path = "surface.json";
			const artifactId = "surface";
			const base = '{"forge":"base","user":"base"}\n';
			const baseHash = await hashContent(base);
			const incoming = '{"forge":"next","user":"base"}\n';
			const incomingHash = await hashContent(incoming);
			await Effect.runPromise(
				Apply.applyPlan(directory, {
					lockfile: {
						artifacts: {
							[artifactId]: surfaceArtifact(path, baseHash, "json"),
						},
					},
					manifest: { config: {}, installs: [], modules: {} },
					removals: [],
					writes: [{ artifactId, content: base, path }],
				}).pipe(Effect.provide(coreLayer)),
			);
			await writeText(
				join(directory, path),
				'{"forge":"base","user":"local"}\n',
			);
			const lockBefore = await readFile(
				join(directory, ".forge/lock.json"),
				"utf-8",
			);
			let injected = false;
			const racingLayer = applyLayerWithFileSystem((fileSystem) => ({
				...fileSystem,
				writeFileString: (target, content, options) =>
					fileSystem.writeFileString(target, content, options).pipe(
						Effect.tap(() => {
							if (injected || !target.endsWith("/state/lock.json"))
								return Effect.void;
							injected = true;
							return fileSystem.writeFileString(
								join(directory, path),
								'{"forge":"mid-run","user":"mid-run"}\n',
							);
						}),
					),
			}));

			const error = await Effect.runPromise(
				Effect.flip(
					Apply.applyPlan(
						directory,
						{
							lockfile: {
								artifacts: {
									[artifactId]: surfaceArtifact(path, incomingHash, "json"),
								},
							},
							manifest: { config: {}, installs: [], modules: {} },
							removals: [],
							writes: [
								{ artifactId, content: incoming, path },
								{ content: "new\n", path: "new.txt" },
							],
						},
						{ resolutionPolicy: "keep-user" },
					).pipe(Effect.provide(racingLayer)),
				),
			);
			expect(error).toMatchObject({ message: "Managed File Modified", path });
			expect(await readFile(join(directory, path), "utf-8")).toBe(
				'{"forge":"mid-run","user":"mid-run"}\n',
			);
			expect(await readFile(join(directory, ".forge/lock.json"), "utf-8")).toBe(
				lockBefore,
			);
			await expect(
				readFile(join(directory, "new.txt"), "utf-8"),
			).rejects.toThrow();
		});
	});

	it("maps content hashing failures", async () => {
		await withTempDir("apply-hash-failure", async (directory) => {
			await writeText(join(directory, "existing.txt"), "existing\n");
			const digest = vi
				.spyOn(globalThis.crypto.subtle, "digest")
				.mockRejectedValue(new Error("simulated digest failure"));
			try {
				const error = await Effect.runPromise(
					Effect.flip(
						Apply.applyPlan(
							directory,
							emptyPlan([{ content: "incoming\n", path: "existing.txt" }]),
						).pipe(Effect.provide(coreLayer)),
					),
				);
				expect(error).toMatchObject({
					message: "Content Hash Failed",
					path: "content",
				});
			} finally {
				digest.mockRestore();
			}
		});
	});

	it("maps managed file read failures", async () => {
		await withTempDir("apply-read-failure", async (directory) => {
			const path = join(directory, "existing.txt");
			await writeText(path, "existing\n");
			const failingLayer = applyLayerWithFileSystem((fileSystem) => ({
				...fileSystem,
				readFileString: (target, encoding) =>
					target === path
						? systemFailure("readFileString", target)
						: fileSystem.readFileString(target, encoding),
			}));
			const error = await Effect.runPromise(
				Effect.flip(
					Apply.applyPlan(
						directory,
						emptyPlan([{ content: "incoming\n", path: "existing.txt" }]),
					).pipe(Effect.provide(failingLayer)),
				),
			);
			expect(error).toMatchObject({
				message: "File Read Failed",
				path: "existing.txt",
			});
		});
	});

	it("maps managed file existence failures with the original cause", async () => {
		await withTempDir("apply-exists-failure", async (directory) => {
			const relativePath = "existing.txt";
			const path = join(directory, relativePath);
			const cause = PlatformError.systemError({
				method: "exists",
				module: "FileSystem",
				pathOrDescriptor: path,
				_tag: "PermissionDenied",
			});
			const failingLayer = applyLayerWithFileSystem((fileSystem) => ({
				...fileSystem,
				exists: (target) =>
					target === path ? Effect.fail(cause) : Effect.succeed(false),
			}));

			const error = await Effect.runPromise(
				Effect.flip(
					Apply.applyPlan(
						directory,
						emptyPlan([{ content: "incoming\n", path: relativePath }]),
					).pipe(Effect.provide(failingLayer)),
				),
			);

			expect(error).toBeInstanceOf(ApplyError);
			if (!(error instanceof ApplyError))
				throw new Error("Expected ApplyError");
			expect(error.path).toBe(relativePath);
			expect(error.reason).toBe("file-read-failed");
			expect(error.message).toBe("File Read Failed");
			expect(error.cause).toMatchObject({
				_tag: "PlatformError",
				reason: {
					_tag: "PermissionDenied",
					method: "exists",
					pathOrDescriptor: path,
				},
			});
		});
	});

	it("skips a removal that disappears between preflight and commit", async () => {
		await withTempDir("apply-removal-race", async (directory) => {
			const relativePath = "old.txt";
			const path = join(directory, relativePath);
			const content = "old\n";
			await writeText(path, content);
			await Effect.runPromise(
				State.writeLockfile(directory, {
					artifacts: {
						old: {
							definitionIds: ["fixture"],
							hash: await hashContent(content),
							kind: "file",
							path: relativePath,
						},
					},
				}).pipe(Effect.provide(coreLayer)),
			);
			let targetChecks = 0;
			const racingLayer = applyLayerWithFileSystem((fileSystem) => ({
				...fileSystem,
				exists: (target) => {
					if (target === path) {
						targetChecks++;
						if (targetChecks > 1) return Effect.succeed(false);
					}
					return fileSystem.exists(target);
				},
			}));

			await Effect.runPromise(
				Apply.applyPlan(directory, {
					...emptyPlan(),
					removals: [relativePath],
				}).pipe(Effect.provide(racingLayer)),
			);
			expect(await readFile(path, "utf-8")).toBe(content);
		});
	});

	it("skips pruning when the project root cannot be canonicalized", async () => {
		await withTempDir("apply-prune-root-failure", async (directory) => {
			const path = "nested/old.txt";
			const content = "old\n";
			await writeText(join(directory, path), content);
			await Effect.runPromise(
				State.writeLockfile(directory, {
					artifacts: {
						old: {
							definitionIds: ["fixture"],
							hash: await hashContent(content),
							kind: "file",
							path,
						},
					},
				}).pipe(Effect.provide(coreLayer)),
			);
			const noRealPathsLayer = applyLayerWithFileSystem((fileSystem) => ({
				...fileSystem,
				realPath: (target) => systemFailure("realPath", target),
			}));

			await Effect.runPromise(
				Apply.applyPlan(directory, {
					...emptyPlan(),
					removals: [path],
				}).pipe(Effect.provide(noRealPathsLayer)),
			);
			await expect(readFile(join(directory, path), "utf-8")).rejects.toThrow();
		});
	});

	it("stops pruning when an ancestor cannot be canonicalized", async () => {
		await withTempDir("apply-prune-ancestor-failure", async (directory) => {
			const relativePath = "nested/old.txt";
			const path = join(directory, relativePath);
			const nested = join(directory, "nested");
			const content = "old\n";
			await writeText(path, content);
			await Effect.runPromise(
				State.writeLockfile(directory, {
					artifacts: {
						old: {
							definitionIds: ["fixture"],
							hash: await hashContent(content),
							kind: "file",
							path: relativePath,
						},
					},
				}).pipe(Effect.provide(coreLayer)),
			);
			const ancestorFailureLayer = applyLayerWithFileSystem((fileSystem) => ({
				...fileSystem,
				realPath: (target) =>
					target === nested
						? systemFailure("realPath", target)
						: fileSystem.realPath(target),
			}));

			await Effect.runPromise(
				Apply.applyPlan(directory, {
					...emptyPlan(),
					removals: [relativePath],
				}).pipe(Effect.provide(ancestorFailureLayer)),
			);
			await expect(readFile(path, "utf-8")).rejects.toThrow();
			expect(
				await readFile(join(directory, ".forge/lock.json"), "utf-8"),
			).toContain('"artifacts": {}');
		});
	});
});
