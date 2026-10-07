import { mkdir, readFile, stat, symlink } from "node:fs/promises";
import { join } from "node:path";
import { NodeServices } from "@effect/platform-node";
import { Effect, FileSystem, Layer, PlatformError } from "effect";
import { describe, expect, it } from "vitest";
import { unifiedDiff } from "../src/diff";
import {
	Apply,
	ApplyError,
	type ApplyPlan,
	CliVersion,
	CoreLive,
	formatApplyError,
	type Lockfile,
	type LockfileArtifact,
	type ResolutionFlag,
	type ResolutionPolicy,
	State,
} from "../src/index";
import { hashContent, readJson, withTempDir, writeText } from "./harness";

async function declinedPlan(
	path: string,
	content: string,
	mergeKind: "opaque" | "json",
): Promise<ApplyPlan> {
	const hash = await hashContent(content);
	const kind = mergeKind === "json" ? "surface" : "file";
	const artifactId = `project:${kind}:${path}`;
	return {
		baseContents: { [artifactId]: content },
		lockfile: {
			artifacts: {
				[artifactId]: {
					base: { hash, mergeKind, semanticsVersion: 1 },
					definitionIds: ["test"],
					hash,
					kind,
					path,
				},
			},
		},
		manifest: { config: {}, installs: [], modules: {} },
		removals: [],
		writes: [{ artifactId, path, content }],
	};
}

async function pathExists(path: string) {
	try {
		await stat(path);
		return true;
	} catch {
		return false;
	}
}

const coreLayer = CoreLive.pipe(
	Layer.provide(Layer.succeed(CliVersion, { version: "test-cli-version" })),
	Layer.provideMerge(NodeServices.layer),
);

describe("apply", () => {
	it("persists declined opaque changes and clears them on the next apply", async () => {
		await withTempDir("apply-declined-opaque", async (directory) => {
			const path = "apps/web/src/auth.ts";
			const base = "original\n";
			const user = "user\n";
			const incoming = "forge\nextra\n";

			await Effect.runPromise(
				Apply.applyPlan(
					directory,
					await declinedPlan(path, base, "opaque"),
				).pipe(Effect.provide(coreLayer)),
			);

			await writeText(join(directory, path), user);

			const plan = await declinedPlan(path, incoming, "opaque");
			const result = await Effect.runPromise(
				Apply.applyPlan(directory, plan, {
					resolutionPolicy: "keep-user",
				}).pipe(Effect.provide(coreLayer)),
			);

			const diff = unifiedDiff(path, base, incoming);
			const diffPath = `.forge/declined/${path}.diff`;

			expect(await readFile(join(directory, path), "utf-8")).toBe(user);
			expect(result.declined).toEqual([
				{ path, diff, added: 2, removed: 1, diffPath },
			]);

			expect(await readFile(join(directory, diffPath), "utf-8")).toBe(diff);

			const repeated = await Effect.runPromise(
				Apply.applyPlan(directory, plan).pipe(Effect.provide(coreLayer)),
			);

			expect(repeated.declined).toEqual([]);
			expect(await pathExists(join(directory, ".forge/declined"))).toBe(false);
		});
	});

	it("reports nothing when an opaque render has not changed", async () => {
		await withTempDir("apply-declined-unchanged", async (directory) => {
			const plan = await declinedPlan("config.txt", "original\n", "opaque");
			await Effect.runPromise(
				Apply.applyPlan(directory, plan).pipe(Effect.provide(coreLayer)),
			);

			await writeText(join(directory, "config.txt"), "user\n");

			const result = await Effect.runPromise(
				Apply.applyPlan(directory, plan, {
					resolutionPolicy: "keep-user",
				}).pipe(Effect.provide(coreLayer)),
			);

			expect(result.declined).toEqual([]);
			expect(await pathExists(join(directory, ".forge/declined"))).toBe(false);
		});
	});

	it("reports nothing for an edited file without a base when Forge's render is unchanged", async () => {
		await withTempDir("apply-declined-baseless", async (directory) => {
			const path = "apps/web/app/page.tsx";
			const content = "render\n";
			const artifactId = `project:file:${path}`;
			const plan: ApplyPlan = {
				lockfile: {
					artifacts: {
						[artifactId]: {
							definitionIds: ["test"],
							hash: await hashContent(content),
							kind: "file",
							path,
						},
					},
				},
				manifest: { config: {}, installs: [], modules: {} },
				removals: [],
				writes: [{ artifactId, path, content }],
			};

			await Effect.runPromise(
				Apply.applyPlan(directory, plan).pipe(Effect.provide(coreLayer)),
			);

			await writeText(join(directory, path), "user\n");

			const result = await Effect.runPromise(
				Apply.applyPlan(directory, plan, {
					resolutionPolicy: "keep-user",
				}).pipe(Effect.provide(coreLayer)),
			);

			expect(await readFile(join(directory, path), "utf-8")).toBe("user\n");
			expect(result.declined).toEqual([]);
		});
	});

	it.each([false, true])(
		"reports only conflicting package keys (conflict: %s)",
		async (conflict) => {
			await withTempDir("apply-declined-keyed", async (directory) => {
				const path = "package.json";
				const base = '{\n  "name": "original",\n  "version": "1"\n}\n';
				const user = '{\n  "name": "user",\n  "version": "1"\n}\n';
				const incoming = `{\n  "name": "${conflict ? "forge" : "original"}",\n  "version": "2"\n}\n`;

				await Effect.runPromise(
					Apply.applyPlan(
						directory,
						await declinedPlan(path, base, "json"),
					).pipe(Effect.provide(coreLayer)),
				);

				await writeText(join(directory, path), user);

				const result = await Effect.runPromise(
					Apply.applyPlan(
						directory,
						await declinedPlan(path, incoming, "json"),
						{ resolutionPolicy: "keep-user" },
					).pipe(Effect.provide(coreLayer)),
				);

				const merged = '{\n  "name": "user",\n  "version": "2"\n}\n';

				expect(await readFile(join(directory, path), "utf-8")).toBe(merged);
				expect(result.declined).toEqual(
					conflict
						? [
								{
									path,
									diff: unifiedDiff(path, merged, incoming),
									added: 1,
									removed: 1,
									diffPath: `.forge/declined/${path}.diff`,
								},
							]
						: [],
				);

				if (!conflict)
					expect(await pathExists(join(directory, ".forge/declined"))).toBe(
						false,
					);
			});
		},
	);

	it.each([
		{ path: ".gitattributes", policy: "refuse" },
		{ path: "nested/.gitattributes", policy: "refuse" },
		{ path: ".gitattributes", policy: "keep-user" },
	] satisfies ReadonlyArray<{ path: string; policy: ResolutionPolicy }>)(
		"adopts unmanaged $path under $policy and preserves it on a second apply",
		async ({ path, policy }) => {
			await withTempDir("apply-adopt-attributes", async (directory) => {
				const current = "# User attributes\r\n\r\n*.png binary\r\n";
				const incoming = "# Forge state\n.forge/** -text\n";
				const incomingHash = await hashContent(incoming);
				const artifactId = "project:surface:gitattributes";
				const plan: ApplyPlan = {
					baseContents: { [artifactId]: incoming },
					lockfile: {
						artifacts: {
							[artifactId]: {
								base: {
									hash: incomingHash,
									mergeKind: "lines",
									semanticsVersion: 1,
								},
								definitionIds: ["root"],
								hash: incomingHash,
								kind: "surface",
								path,
							},
						},
					},
					manifest: { config: {}, installs: [], modules: {} },
					removals: [],
					writes: [{ artifactId, content: incoming, path }],
				};

				await writeText(join(directory, path), current);
				await Effect.runPromise(
					Apply.applyPlan(directory, plan, { resolutionPolicy: policy }).pipe(
						Effect.provide(coreLayer),
					),
				);

				const adopted = `${current}\n${incoming}`;
				expect(await readFile(join(directory, path), "utf-8")).toBe(adopted);
				const lockfile = await readJson<Lockfile>(
					join(directory, ".forge/lock.json"),
				);

				expect(lockfile.artifacts[artifactId]).toMatchObject({
					hash: await hashContent(adopted),
					base: { hash: incomingHash },
				});

				expect(
					await readFile(
						join(directory, ".forge/bases", incomingHash),
						"utf-8",
					),
				).toBe(incoming);

				await Effect.runPromise(
					Apply.applyPlan(directory, plan).pipe(Effect.provide(coreLayer)),
				);

				expect(await readFile(join(directory, path), "utf-8")).toBe(adopted);
			});
		},
	);

	it("still refuses an unmanaged gitignore lines surface", async () => {
		await withTempDir("apply-unmanaged-gitignore", async (directory) => {
			const incoming = "# Build\ndist/\n";
			const hash = await hashContent(incoming);
			const artifactId = "project:surface:gitignore";
			await writeText(join(directory, ".gitignore"), "# User\n\nlocal/\n");

			const error = await Effect.runPromise(
				Apply.applyPlan(directory, {
					baseContents: { [artifactId]: incoming },
					lockfile: {
						artifacts: {
							[artifactId]: {
								base: { hash, mergeKind: "lines", semanticsVersion: 1 },
								definitionIds: ["gitignore"],
								hash,
								kind: "surface",
								path: ".gitignore",
							},
						},
					},
					manifest: { config: {}, installs: [], modules: {} },
					removals: [],
					writes: [{ artifactId, content: incoming, path: ".gitignore" }],
				}).pipe(Effect.flip, Effect.provide(coreLayer)),
			);

			expect(error).toMatchObject({ reason: "unmanaged-file-exists" });
			expect(await readFile(join(directory, ".gitignore"), "utf-8")).toBe(
				"# User\n\nlocal/\n",
			);
		});
	});

	it.each([
		{ mergeKind: "opaque", matching: false },
		{ mergeKind: "json", matching: false },
		{ mergeKind: "opaque", matching: true },
		{ mergeKind: "json", matching: true },
	] satisfies ReadonlyArray<{
		mergeKind: "opaque" | "json";
		matching: boolean;
	}>)(
		"keeps an unmanaged $mergeKind file (matching: $matching) and manages it",
		async ({ mergeKind, matching }) => {
			await withTempDir("apply-keep-adopt", async (directory) => {
				const path = mergeKind === "json" ? "user.json" : "user.txt";
				const current =
					mergeKind === "json" ? '{ "mine": true }\n' : "user bytes\n";

				const incoming = matching
					? current
					: mergeKind === "json"
						? '{"forge":true}\n'
						: "forge bytes\n";

				const currentHash = await hashContent(current);
				const incomingHash = await hashContent(incoming);
				const artifactId = `project:${mergeKind === "json" ? "surface" : "file"}:${path}`;
				const artifact: LockfileArtifact = {
					base: { hash: incomingHash, mergeKind, semanticsVersion: 1 },
					definitionIds: ["fixture"],
					hash: incomingHash,
					kind: mergeKind === "json" ? "surface" : "file",
					path,
				};

				await writeText(join(directory, path), current);

				await Effect.runPromise(
					Apply.applyPlan(
						directory,
						{
							lockfile: { artifacts: { [artifactId]: artifact } },
							manifest: { config: {}, installs: [], modules: {} },
							removals: [],
							writes: [{ artifactId, content: incoming, path }],
						},
						{ resolutionPolicy: "keep-user" },
					).pipe(Effect.provide(coreLayer)),
				);

				const lockfile = await Effect.runPromise(
					State.readLockfile(directory).pipe(Effect.provide(coreLayer)),
				);

				expect(await readFile(join(directory, path), "utf-8")).toBe(current);
				expect(lockfile.artifacts[artifactId]).toEqual(
					matching
						? artifact
						: {
								...artifact,
								hash: currentHash,
								base: {
									hash: currentHash,
									mergeKind,
									origin: "adopted",
									semanticsVersion: 1,
								},
							},
				);

				expect(
					await readFile(join(directory, ".forge/bases", currentHash), "utf-8"),
				).toBe(current);
			});
		},
	);

	it("refuses to adopt an unmanaged module marker under keep-user", async () => {
		await withTempDir("apply-keep-marker", async (directory) => {
			const artifactId = "module:web:file:forge.json";
			const path = "apps/web/forge.json";
			const content = '{"id":"web"}\n';
			await writeText(join(directory, path), '{"id":"user"}\n');
			await writeText(join(directory, "kept.txt"), "mine\n");

			const error = await Effect.runPromise(
				Effect.flip(
					Apply.applyPlan(
						directory,
						{
							lockfile: {
								artifacts: {
									[artifactId]: {
										definitionIds: ["fixture"],
										hash: await hashContent(content),
										kind: "file",
										path,
									},
									"project:file:kept.txt": {
										definitionIds: ["fixture"],
										hash: await hashContent("forge\n"),
										kind: "file",
										path: "kept.txt",
									},
								},
							},
							manifest: { config: {}, installs: [], modules: {} },
							removals: [],
							writes: [
								{ artifactId, content, path },
								{
									artifactId: "project:file:kept.txt",
									content: "forge\n",
									path: "kept.txt",
								},
								{ content: "new\n", path: "created.txt" },
							],
						},
						{ resolutionPolicy: "keep-user" },
					).pipe(Effect.provide(coreLayer)),
				),
			);

			expect(error).toMatchObject({
				preflight: { refusals: [{ path, resolvedBy: ["accept-forge"] }] },
			});

			expect(await readFile(join(directory, path), "utf-8")).toBe(
				'{"id":"user"}\n',
			);

			expect(await readFile(join(directory, "kept.txt"), "utf-8")).toBe(
				"mine\n",
			);

			for (const untouched of [
				"created.txt",
				".forge/lock.json",
				".forge/bases",
			])
				await expect(stat(join(directory, untouched))).rejects.toMatchObject({
					code: "ENOENT",
				});
		});
	});

	it("retains an unmanaged removal under keep-user", async () => {
		await withTempDir("apply-keep-unmanaged-removal", async (directory) => {
			await writeText(join(directory, "user.txt"), "mine\n");

			const result = await Effect.runPromise(
				Apply.applyPlan(
					directory,
					{
						lockfile: { artifacts: {} },
						manifest: { config: {}, installs: [], modules: {} },
						removals: ["user.txt"],
						writes: [],
					},
					{ resolutionPolicy: "keep-user" },
				).pipe(Effect.provide(coreLayer)),
			);

			expect(result.retained).toEqual(["user.txt"]);
			expect(await readFile(join(directory, "user.txt"), "utf-8")).toBe(
				"mine\n",
			);
		});
	});

	it.each([
		{
			name: "edited only",
			entries: ["opaque-write"],
			flags: ["keep-user", "accept-forge"],
		},
		{
			name: "edited with an opaque base",
			entries: ["opaque-base-write"],
			flags: ["keep-user", "accept-forge"],
		},
		{
			name: "unmanaged only",
			entries: ["unmanaged-write"],
			flags: ["keep-user", "accept-forge"],
		},
		{
			name: "edited plus unmanaged",
			entries: ["opaque-write", "unmanaged-write"],
			flags: ["keep-user", "accept-forge"],
		},
		{
			name: "edited opaque removal plus unmanaged",
			entries: ["opaque-removal", "unmanaged-write"],
			flags: ["accept-forge"],
		},
		{
			name: "json residue removal plus conflict",
			entries: ["json-removal", "json-write"],
			flags: ["keep-user", "accept-forge"],
		},
		{
			name: "removal scope with outside conflict",
			entries: ["unmanaged-write", "json-write"],
			flags: ["keep-user"],
			removedRoots: ["apps/gone"],
		},
	] satisfies ReadonlyArray<{
		name: string;
		entries: ReadonlyArray<
			| "opaque-write"
			| "opaque-base-write"
			| "unmanaged-write"
			| "opaque-removal"
			| "json-removal"
			| "json-write"
		>;
		flags: ReadonlyArray<ResolutionFlag>;
		removedRoots?: ReadonlyArray<string>;
	}>)("suggests only completing flags for $name", async (fixture) => {
		const outcomes: Array<{
			readonly current: string;
			readonly incoming: string;
			readonly path: string;
		}> = [];

		const seed = async (directory: string): Promise<ApplyPlan> => {
			const previous: Record<string, LockfileArtifact> = {};
			const next: Record<string, LockfileArtifact> = {};
			const writes: Array<ApplyPlan["writes"][number]> = [];
			const removals: string[] = [];
			outcomes.length = 0;

			for (const entry of fixture.entries) {
				const isJson = entry.startsWith("json");
				const mergeKind = isJson
					? "json"
					: entry === "opaque-base-write"
						? "opaque"
						: undefined;

				const path =
					entry === "unmanaged-write" && "removedRoots" in fixture
						? "apps/gone/user.txt"
						: `${entry}.${isJson ? "json" : "txt"}`;

				const base = isJson ? '{"value":"base"}\n' : "base\n";
				const current =
					entry === "json-removal"
						? '{"value":"base","mine":true}\n'
						: isJson
							? '{"value":"user"}\n'
							: "user\n";

				const incoming = isJson ? '{"value":"forge"}\n' : "forge\n";
				const baseHash = await hashContent(base);
				const incomingHash = await hashContent(incoming);
				const artifact: LockfileArtifact = {
					...(mergeKind === undefined
						? {}
						: {
								base: {
									hash: baseHash,
									mergeKind,
									semanticsVersion: 1,
								} satisfies LockfileArtifact["base"],
							}),
					definitionIds: ["fixture"],
					hash: baseHash,
					kind: isJson ? "surface" : "file",
					path,
				};

				await writeText(join(directory, path), current);

				if (entry !== "unmanaged-write") previous[entry] = artifact;
				if (mergeKind !== undefined)
					await Effect.runPromise(
						State.writeBase(directory, baseHash, base).pipe(
							Effect.provide(coreLayer),
						),
					);

				if (entry.endsWith("removal")) removals.push(path);
				else {
					next[entry] = {
						...artifact,
						hash: incomingHash,
						...(mergeKind === undefined
							? {}
							: {
									base: {
										hash: incomingHash,
										mergeKind,
										semanticsVersion: 1,
									},
								}),
					};

					writes.push({ artifactId: entry, content: incoming, path });
					outcomes.push({ current, incoming, path });
				}
			}

			await Effect.runPromise(
				State.writeLockfile(directory, { artifacts: previous }).pipe(
					Effect.provide(coreLayer),
				),
			);

			return {
				lockfile: { artifacts: next },
				manifest: { config: {}, installs: [], modules: {} },
				removals,
				writes,
				...("removedRoots" in fixture
					? { removedRoots: fixture.removedRoots }
					: {}),
			};
		};

		const suggested = await withTempDir(
			"apply-guidance-default",
			async (directory) => {
				const plan = await seed(directory);
				const error = await Effect.runPromise(
					Effect.flip(
						Apply.applyPlan(directory, plan).pipe(Effect.provide(coreLayer)),
					),
				);

				if (!(error instanceof ApplyError))
					throw new Error("Expected Apply Error");

				const guidance = formatApplyError(error)
					.split("\n")
					.flatMap(
						(sentence) =>
							/run again with (.*)$/i.exec(sentence)?.slice(1) ?? [],
					)
					.join("\n");

				const flags = (
					["keep-user", "accept-forge"] satisfies ReadonlyArray<ResolutionFlag>
				).filter((flag) => guidance.includes(`--${flag}`));

				expect(flags).toEqual(fixture.flags);

				if ("removedRoots" in fixture)
					expect(error.preflight?.outsideRemoval).toEqual(["json-write.json"]);

				return flags;
			},
		);

		for (const flag of [
			"keep-user",
			"accept-forge",
		] satisfies ReadonlyArray<ResolutionFlag>)
			await withTempDir(`apply-guidance-${flag}`, async (directory) => {
				const plan = await seed(directory);
				const result = await Effect.runPromise(
					Effect.result(
						Apply.applyPlan(directory, plan, { resolutionPolicy: flag }).pipe(
							Effect.provide(coreLayer),
						),
					),
				);

				if (!suggested.includes(flag)) {
					expect(result._tag).toBe("Failure");

					if (result._tag === "Failure")
						expect(result.failure).toMatchObject({
							reason: expect.stringMatching(
								/^(managed-file-modified|unmanaged-file-exists|preflight-failed)$/,
							),
						});

					return;
				}

				expect(result._tag).toBe("Success");

				for (const outcome of outcomes) {
					const content = await readFile(
						join(directory, outcome.path),
						"utf-8",
					);

					const expected =
						flag === "accept-forge" ? outcome.incoming : outcome.current;

					if (outcome.path.endsWith(".json"))
						expect(JSON.parse(content)).toEqual(JSON.parse(expected));
					else expect(content).toBe(expected);
				}
			});
	});

	it("stages adopted base content without writing the managed artifact", async () => {
		await withTempDir("apply-adopted-base", async (directory) => {
			const content = '{\n\t"name": "user-project"\n}\n';
			const hash = await hashContent(content);
			const path = "package.json";
			const artifactId = "project:surface:rootPackageJson";
			await writeText(join(directory, path), content);

			await Effect.runPromise(
				Apply.applyPlan(directory, {
					baseContents: { [artifactId]: content },
					lockfile: {
						artifacts: {
							[artifactId]: {
								base: {
									hash,
									mergeKind: "json",
									semanticsVersion: 1,
								},
								definitionIds: ["root"],
								hash,
								kind: "surface",
								path,
							},
						},
					},
					manifest: { config: {}, installs: [], modules: {} },
					removals: [],
					writes: [],
				}).pipe(Effect.provide(coreLayer)),
			);

			expect(await readFile(join(directory, path), "utf-8")).toBe(content);
			await expect(
				Effect.runPromise(
					State.readBase(directory, hash).pipe(Effect.provide(coreLayer)),
				),
			).resolves.toBe(content);
		});
	});

	it("refuses writes whose paths escape the project root", async () => {
		await withTempDir("apply-write-escape", async (scratch) => {
			const projectRoot = join(scratch, "project");
			const outside = join(scratch, "escape.txt");

			await mkdir(projectRoot, { recursive: true });

			const error = await Effect.runPromise(
				Effect.flip(
					Apply.applyPlan(projectRoot, {
						lockfile: { artifacts: {} },
						manifest: { config: {}, installs: [], modules: {} },
						removals: [],
						writes: [{ content: "escaped\n", path: "../escape.txt" }],
					}).pipe(Effect.provide(coreLayer)),
				),
			);

			expect(error).toMatchObject({
				_tag: "ApplyError",
				message: "Path Escapes Project Root",
				path: "../escape.txt",
			});

			expect(await pathExists(outside)).toBe(false);
		});
	});

	it("refuses removals whose paths escape the project root", async () => {
		await withTempDir("apply-remove-escape", async (scratch) => {
			const projectRoot = join(scratch, "project");
			const outside = join(scratch, "outside.txt");
			const content = "managed\n";

			await mkdir(projectRoot, { recursive: true });
			await writeText(outside, content);
			await Effect.runPromise(
				State.writeLockfile(projectRoot, {
					artifacts: {
						"project:file:../outside.txt": {
							definitionIds: ["test"],
							hash: await hashContent(content),
							kind: "file",
							path: "../outside.txt",
						},
					},
				}).pipe(Effect.provide(coreLayer)),
			);

			const error = await Effect.runPromise(
				Effect.flip(
					Apply.applyPlan(projectRoot, {
						lockfile: { artifacts: {} },
						manifest: { config: {}, installs: [], modules: {} },
						removals: ["../outside.txt"],
						writes: [],
					}).pipe(Effect.provide(coreLayer)),
				),
			);

			expect(error).toMatchObject({
				_tag: "ApplyError",
				message: "Path Escapes Project Root",
				path: "../outside.txt",
			});

			expect(await readFile(outside, "utf-8")).toBe(content);
		});
	});

	it("refuses absolute write paths", async () => {
		await withTempDir("apply-absolute-write", async (scratch) => {
			const projectRoot = join(scratch, "project");
			const outside = join(scratch, "absolute.txt");

			await mkdir(projectRoot, { recursive: true });

			const error = await Effect.runPromise(
				Effect.flip(
					Apply.applyPlan(projectRoot, {
						lockfile: { artifacts: {} },
						manifest: { config: {}, installs: [], modules: {} },
						removals: [],
						writes: [{ content: "escaped\n", path: outside }],
					}).pipe(Effect.provide(coreLayer)),
				),
			);

			expect(error).toMatchObject({
				_tag: "ApplyError",
				message: "Path Escapes Project Root",
				path: outside,
			});

			expect(await pathExists(outside)).toBe(false);
		});
	});

	it("allows nested writes and removals within the project root", async () => {
		await withTempDir("apply-contained-paths", async (directory) => {
			const removedPath = "packages/db/src/index.ts";
			const removedContent = "export const oldValue = true;\n";
			const writtenPath = "apps/web/app/page.tsx";
			const writtenContent = "export default function Page() {}\n";

			await writeText(join(directory, removedPath), removedContent);
			await Effect.runPromise(
				State.writeLockfile(directory, {
					artifacts: {
						[`project:file:${removedPath}`]: {
							definitionIds: ["test"],
							hash: await hashContent(removedContent),
							kind: "file",
							path: removedPath,
						},
					},
				}).pipe(Effect.provide(coreLayer)),
			);

			await Effect.runPromise(
				Apply.applyPlan(directory, {
					lockfile: { artifacts: {} },
					manifest: { config: {}, installs: [], modules: {} },
					removals: [removedPath],
					writes: [{ content: writtenContent, path: writtenPath }],
				}).pipe(Effect.provide(coreLayer)),
			);

			expect(await pathExists(join(directory, removedPath))).toBe(false);
			expect(await readFile(join(directory, writtenPath), "utf-8")).toBe(
				writtenContent,
			);
		});
	});

	it.each([false, true])(
		"checks original ownership when removing a relocated file (modified: %s)",
		async (modified) => {
			await withTempDir("apply-relocated-removal", async (directory) => {
				const previousPath = "apps/admin/index.ts";
				const currentPath = "apps/dashboard/index.ts";
				const generatedContent = "export const generated = true;\n";
				const currentContent = modified ? "Keep my code.\n" : generatedContent;

				await writeText(join(directory, currentPath), currentContent);
				await writeText(
					join(directory, "apps/dashboard/notes.txt"),
					"Keep notes.\n",
				);

				await Effect.runPromise(
					State.writeLockfile(directory, {
						artifacts: {
							"project:file:app": {
								definitionIds: ["test"],
								hash: await hashContent(generatedContent),
								kind: "file",
								path: previousPath,
							},
						},
					}).pipe(Effect.provide(coreLayer)),
				);

				const result = await Effect.runPromise(
					Apply.applyPlan(
						directory,
						{
							lockfile: { artifacts: {} },
							manifest: { config: {}, installs: [], modules: {} },
							removalRootRelocations: { "apps/admin": "apps/dashboard" },
							removals: [previousPath],
							writes: [],
						},
						{ resolutionPolicy: "keep-user" },
					).pipe(Effect.provide(coreLayer), Effect.result),
				);

				expect(result._tag).toBe(modified ? "Failure" : "Success");
				expect(await pathExists(join(directory, currentPath))).toBe(modified);
				expect(
					await readFile(join(directory, "apps/dashboard/notes.txt"), "utf-8"),
				).toBe("Keep notes.\n");
			});
		},
	);

	it("uses the most specific root for relocated removals", async () => {
		await withTempDir("apply-overlapping-relocations", async (directory) => {
			const previousPath = "apps/admin/index.ts";
			const currentPath = "sites/dashboard/index.ts";
			const unrelatedPath = "sites/admin/index.ts";
			const content = "export const generated = true;\n";

			await writeText(join(directory, currentPath), content);
			await writeText(join(directory, unrelatedPath), content);
			await Effect.runPromise(
				State.writeLockfile(directory, {
					artifacts: {
						"project:file:app": {
							definitionIds: ["test"],
							hash: await hashContent(content),
							kind: "file",
							path: previousPath,
						},
					},
				}).pipe(Effect.provide(coreLayer)),
			);

			await Effect.runPromise(
				Apply.applyPlan(directory, {
					lockfile: { artifacts: {} },
					manifest: { config: {}, installs: [], modules: {} },
					removalRootRelocations: {
						apps: "sites",
						"apps/admin": "sites/dashboard",
					},
					removals: [previousPath],
					writes: [],
				}).pipe(Effect.provide(coreLayer)),
			);

			expect(await pathExists(join(directory, currentPath))).toBe(false);
			expect(await readFile(join(directory, unrelatedPath), "utf-8")).toBe(
				content,
			);
		});
	});

	it("creates a missing project root for contained writes", async () => {
		await withTempDir("apply-create-root", async (scratch) => {
			const projectRoot = join(scratch, "project");
			const path = "apps/web/app/page.tsx";
			const content = "export default function Page() {}\n";

			await Effect.runPromise(
				Apply.applyPlan(projectRoot, {
					lockfile: { artifacts: {} },
					manifest: { config: {}, installs: [], modules: {} },
					removals: [],
					writes: [{ content, path }],
				}).pipe(Effect.provide(coreLayer)),
			);

			expect(await readFile(join(projectRoot, path), "utf-8")).toBe(content);
		});
	});

	it("creates a missing .env without recording it in the lockfile", async () => {
		await withTempDir("apply-create-env", async (directory) => {
			const content = 'AUTH_SECRET="generated"\n';
			const hash = await hashContent(content);
			const artifact = {
				definitionIds: ["better-auth"],
				hash,
				kind: "surface",
				path: ".env",
			} satisfies LockfileArtifact;

			await Effect.runPromise(
				Apply.applyPlan(directory, {
					lockfile: {
						artifacts: { "project:surface:rootEnv": artifact },
					},
					manifest: { config: {}, installs: [], modules: {} },
					removals: [],
					writes: [
						{
							artifactId: "project:surface:rootEnv",
							content,
							path: ".env",
						},
					],
				}).pipe(Effect.provide(coreLayer)),
			);

			expect(await readFile(join(directory, ".env"), "utf-8")).toBe(content);
			const lockfile = await Effect.runPromise(
				State.readLockfile(directory).pipe(Effect.provide(coreLayer)),
			);

			expect(lockfile.artifacts).toEqual({});
		});
	});

	it("leaves an existing .env unchanged", async () => {
		await withTempDir("apply-user-owned-env", async (directory) => {
			const userContent = 'AUTH_SECRET="user-secret"\n';
			const generatedContent = 'AUTH_SECRET="generated"\n';
			await writeText(join(directory, ".env"), userContent);

			await Effect.runPromise(
				Apply.applyPlan(directory, {
					lockfile: {
						artifacts: {
							"project:surface:rootEnv": {
								definitionIds: ["better-auth"],
								hash: await hashContent(generatedContent),
								kind: "surface",
								path: ".env",
							},
						},
					},
					manifest: { config: {}, installs: [], modules: {} },
					removals: [],
					writes: [
						{
							artifactId: "project:surface:rootEnv",
							content: generatedContent,
							path: ".env",
						},
					],
				}).pipe(Effect.provide(coreLayer)),
			);

			expect(await readFile(join(directory, ".env"), "utf-8")).toBe(
				userContent,
			);

			const lockfile = await Effect.runPromise(
				State.readLockfile(directory).pipe(Effect.provide(coreLayer)),
			);

			expect(lockfile.artifacts).toEqual({});
		});
	});

	it("does not remove a user-owned .env", async () => {
		await withTempDir("apply-remove-user-owned-env", async (directory) => {
			const userContent = 'AUTH_SECRET="user-secret"\n';
			await writeText(join(directory, ".env"), userContent);

			await Effect.runPromise(
				State.writeLockfile(directory, {
					artifacts: {
						"project:file:.env": {
							definitionIds: ["better-auth"],
							hash: await hashContent('AUTH_SECRET="managed"\n'),
							kind: "file",
							path: ".env",
						},
					},
				}).pipe(Effect.provide(coreLayer)),
			);

			await Effect.runPromise(
				Apply.applyPlan(directory, {
					lockfile: { artifacts: {} },
					manifest: { config: {}, installs: [], modules: {} },
					removals: [".env"],
					writes: [],
				}).pipe(Effect.provide(coreLayer)),
			);

			expect(await readFile(join(directory, ".env"), "utf-8")).toBe(
				userContent,
			);
		});
	});

	it("continues to reconcile .env.example", async () => {
		await withTempDir("apply-env-example", async (directory) => {
			const oldContent = 'AUTH_SECRET=""\n';
			const nextContent = 'AUTH_SECRET="new-template"\n';
			await writeText(join(directory, ".env.example"), oldContent);

			await Effect.runPromise(
				State.writeLockfile(directory, {
					artifacts: {
						"project:file:.env.example": {
							definitionIds: ["better-auth"],
							hash: await hashContent(oldContent),
							kind: "file",
							path: ".env.example",
						},
					},
				}).pipe(Effect.provide(coreLayer)),
			);

			await Effect.runPromise(
				Apply.applyPlan(directory, {
					lockfile: { artifacts: {} },
					manifest: { config: {}, installs: [], modules: {} },
					removals: [],
					writes: [{ content: nextContent, path: ".env.example" }],
				}).pipe(Effect.provide(coreLayer)),
			);

			expect(await readFile(join(directory, ".env.example"), "utf-8")).toBe(
				nextContent,
			);
		});
	});

	it("merges edited json, sectioned lines, and env example surfaces", async () => {
		await withTempDir("apply-semantic-surfaces", async (directory) => {
			const packageBase = '{\n\t"scripts": {\n\t\t"dev": "vite"\n\t}\n}\n';
			const gitignoreBase = "# Build\ndist/\n";
			const envBase = "DATABASE_URL=forge-old\n";
			const initialWrites = [
				{
					artifactId: "project:surface:rootPackageJson",
					content: packageBase,
					path: "package.json",
				},
				{
					artifactId: "project:surface:gitignore",
					content: gitignoreBase,
					path: ".gitignore",
				},
				{
					artifactId: "project:surface:rootEnvExample",
					content: envBase,
					path: ".env.example",
				},
			];

			const initialArtifacts: Lockfile["artifacts"] = {
				"project:surface:rootPackageJson": {
					base: {
						hash: await hashContent(packageBase),
						mergeKind: "json",
						semanticsVersion: 1,
					},
					definitionIds: ["root"],
					hash: await hashContent(packageBase),
					kind: "surface",
					path: "package.json",
				},
				"project:surface:gitignore": {
					base: {
						hash: await hashContent(gitignoreBase),
						mergeKind: "lines",
						semanticsVersion: 1,
					},
					definitionIds: ["gitignore"],
					hash: await hashContent(gitignoreBase),
					kind: "surface",
					path: ".gitignore",
				},
				"project:surface:rootEnvExample": {
					base: {
						hash: await hashContent(envBase),
						mergeKind: "env",
						semanticsVersion: 1,
					},
					definitionIds: ["orm"],
					hash: await hashContent(envBase),
					kind: "surface",
					path: ".env.example",
				},
			};

			await Effect.runPromise(
				Apply.applyPlan(directory, {
					lockfile: { artifacts: initialArtifacts },
					manifest: { config: {}, installs: [], modules: {} },
					removals: [],
					writes: initialWrites,
				}).pipe(Effect.provide(coreLayer)),
			);

			await writeText(
				join(directory, "package.json"),
				'{\n\t"scripts": {\n\t\t"dev": "vite --host"\n\t}\n}\n',
			);

			await writeText(
				join(directory, ".gitignore"),
				"# Build\ndist/\n.cache/\n",
			);

			await writeText(
				join(directory, ".env.example"),
				"DATABASE_URL=user-value\n",
			);

			const packageIncoming =
				'{\n\t"scripts": {\n\t\t"dev": "vite",\n\t\t"test": "vitest"\n\t}\n}\n';

			const gitignoreIncoming = "# Build\ndist/\ncoverage/\n";
			const envIncoming = "DATABASE_URL=forge-new\nAUTH_SECRET=\n";
			await Effect.runPromise(
				Apply.applyPlan(directory, {
					lockfile: {
						artifacts: {
							"project:surface:rootPackageJson": {
								base: {
									hash: await hashContent(packageIncoming),
									mergeKind: "json",
									semanticsVersion: 1,
								},
								definitionIds: ["root"],
								hash: await hashContent(packageIncoming),
								kind: "surface",
								path: "package.json",
							},
							"project:surface:gitignore": {
								base: {
									hash: await hashContent(gitignoreIncoming),
									mergeKind: "lines",
									semanticsVersion: 1,
								},
								definitionIds: ["gitignore"],
								hash: await hashContent(gitignoreIncoming),
								kind: "surface",
								path: ".gitignore",
							},
							"project:surface:rootEnvExample": {
								base: {
									hash: await hashContent(envIncoming),
									mergeKind: "env",
									semanticsVersion: 1,
								},
								definitionIds: ["orm"],
								hash: await hashContent(envIncoming),
								kind: "surface",
								path: ".env.example",
							},
						},
					},
					manifest: { config: {}, installs: [], modules: {} },
					removals: [],
					writes: [
						{
							artifactId: "project:surface:rootPackageJson",
							content: packageIncoming,
							path: "package.json",
						},
						{
							artifactId: "project:surface:gitignore",
							content: gitignoreIncoming,
							path: ".gitignore",
						},
						{
							artifactId: "project:surface:rootEnvExample",
							content: envIncoming,
							path: ".env.example",
						},
					],
				}).pipe(Effect.provide(coreLayer)),
			);

			expect(await readJson(join(directory, "package.json"))).toEqual({
				scripts: { dev: "vite --host", test: "vitest" },
			});

			expect(await readFile(join(directory, ".gitignore"), "utf-8")).toBe(
				"# Build\ndist/\n.cache/\ncoverage/\n",
			);

			expect(await readFile(join(directory, ".env.example"), "utf-8")).toBe(
				"DATABASE_URL=user-value\nAUTH_SECRET=\n",
			);

			const packageIncomingHash = await hashContent(packageIncoming);
			const mergedLockfile = await readJson<Lockfile>(
				join(directory, ".forge/lock.json"),
			);

			expect(
				mergedLockfile.artifacts["project:surface:rootPackageJson"],
			).toMatchObject({
				base: { hash: packageIncomingHash },
			});

			expect(
				await readFile(
					join(directory, ".forge/bases", packageIncomingHash),
					"utf-8",
				),
			).toBe(packageIncoming);

			expect(
				await pathExists(
					join(directory, ".forge/bases", await hashContent(packageBase)),
				),
			).toBe(false);

			const thirdPackageRender =
				'{\n\t"scripts": {\n\t\t"build": "vite build",\n\t\t"dev": "vite",\n\t\t"test": "vitest"\n\t}\n}\n';

			const thirdPackageHash = await hashContent(thirdPackageRender);
			await Effect.runPromise(
				Apply.applyPlan(directory, {
					lockfile: {
						artifacts: {
							"project:surface:rootPackageJson": {
								base: {
									hash: thirdPackageHash,
									mergeKind: "json",
									semanticsVersion: 1,
								},
								definitionIds: ["root"],
								hash: thirdPackageHash,
								kind: "surface",
								path: "package.json",
							},
						},
					},
					manifest: { config: {}, installs: [], modules: {} },
					removals: [],
					writes: [
						{
							artifactId: "project:surface:rootPackageJson",
							content: thirdPackageRender,
							path: "package.json",
						},
					],
				}).pipe(Effect.provide(coreLayer)),
			);

			expect(await readJson(join(directory, "package.json"))).toEqual({
				scripts: {
					build: "vite build",
					dev: "vite --host",
					test: "vitest",
				},
			});

			expect(
				await readFile(
					join(directory, ".forge/bases", thirdPackageHash),
					"utf-8",
				),
			).toBe(thirdPackageRender);
		});
	});

	it("wires package dependency removals into apply-time json merging", async () => {
		await withTempDir("apply-dependency-removal", async (directory) => {
			const base = '{\n\t"dependencies": {\n\t\t"react": "19.0.0"\n\t}\n}\n';
			const baseHash = await hashContent(base);
			const initialPlan: ApplyPlan = {
				lockfile: {
					artifacts: {
						"project:surface:rootPackageJson": {
							base: { hash: baseHash, mergeKind: "json", semanticsVersion: 1 },
							definitionIds: ["root"],
							hash: baseHash,
							kind: "surface",
							path: "package.json",
						},
					},
				},
				manifest: { config: {}, installs: [], modules: {} },
				removals: [],
				writes: [
					{
						artifactId: "project:surface:rootPackageJson",
						content: base,
						path: "package.json",
					},
				],
			};

			await Effect.runPromise(
				Apply.applyPlan(directory, initialPlan).pipe(Effect.provide(coreLayer)),
			);

			await writeText(
				join(directory, "package.json"),
				'{\n\t"dependencies": {}\n}\n',
			);

			const incoming =
				'{\n\t"dependencies": {\n\t\t"react": "19.1.0",\n\t\t"vite": "7.0.0"\n\t}\n}\n';

			const incomingHash = await hashContent(incoming);
			await Effect.runPromise(
				Apply.applyPlan(directory, {
					...initialPlan,
					lockfile: {
						artifacts: {
							"project:surface:rootPackageJson": {
								base: {
									hash: incomingHash,
									mergeKind: "json",
									semanticsVersion: 1,
								},
								definitionIds: ["root"],
								hash: incomingHash,
								kind: "surface",
								path: "package.json",
							},
						},
					},
					writes: [
						{
							artifactId: "project:surface:rootPackageJson",
							content: incoming,
							path: "package.json",
						},
					],
				}).pipe(Effect.provide(coreLayer)),
			);

			expect(await readJson(join(directory, "package.json"))).toEqual({
				dependencies: { vite: "7.0.0" },
			});
		});
	});

	it("aggregates semantic conflicts and performs zero mutation", async () => {
		await withTempDir("apply-semantic-conflicts", async (directory) => {
			const base =
				'{\n\t"scripts": {\n\t\t"build": "tsc",\n\t\t"dev": "vite"\n\t}\n}\n';

			const baseHash = await hashContent(base);
			const artifact: LockfileArtifact = {
				base: { hash: baseHash, mergeKind: "json", semanticsVersion: 1 },
				definitionIds: ["root"],
				hash: baseHash,
				kind: "surface",
				path: "package.json",
			};

			const lineBase = "# Build\ndist/\n";
			const lineBaseHash = await hashContent(lineBase);
			const lineArtifact: LockfileArtifact = {
				base: {
					hash: lineBaseHash,
					mergeKind: "lines",
					semanticsVersion: 1,
				},
				definitionIds: ["gitignore"],
				hash: lineBaseHash,
				kind: "surface",
				path: ".gitignore",
			};

			await Effect.runPromise(
				Apply.applyPlan(directory, {
					lockfile: {
						artifacts: {
							"project:surface:gitignore": lineArtifact,
							"project:surface:rootPackageJson": artifact,
						},
					},
					manifest: { config: {}, installs: [], modules: {} },
					removals: [],
					writes: [
						{
							artifactId: "project:surface:rootPackageJson",
							content: base,
							path: "package.json",
						},
						{
							artifactId: "project:surface:gitignore",
							content: lineBase,
							path: ".gitignore",
						},
					],
				}).pipe(Effect.provide(coreLayer)),
			);

			const user =
				'{\n\t"scripts": {\n\t\t"build": "tsc --watch",\n\t\t"dev": "vite --host"\n\t}\n}\n';

			await writeText(join(directory, "package.json"), user);
			const lineUser = "# Build\nbuild/\n";
			await writeText(join(directory, ".gitignore"), lineUser);
			const beforeLock = await readFile(
				join(directory, ".forge/lock.json"),
				"utf-8",
			);

			const incoming =
				'{\n\t"scripts": {\n\t\t"build": "tsc -b",\n\t\t"dev": "vite --port 4000"\n\t}\n}\n';

			const incomingHash = await hashContent(incoming);
			const lineIncoming = "# Build\noutput/\n";
			const lineIncomingHash = await hashContent(lineIncoming);
			const error = await Effect.runPromise(
				Effect.flip(
					Apply.applyPlan(directory, {
						lockfile: {
							artifacts: {
								"project:surface:gitignore": {
									...lineArtifact,
									base: {
										hash: lineIncomingHash,
										mergeKind: "lines",
										semanticsVersion: 1,
									},
									hash: lineIncomingHash,
								},
								"project:surface:rootPackageJson": {
									...artifact,
									base: {
										hash: incomingHash,
										mergeKind: "json",
										semanticsVersion: 1,
									},
									hash: incomingHash,
								},
							},
						},
						manifest: { config: { changed: true }, installs: [], modules: {} },
						removals: [],
						writes: [
							{
								artifactId: "project:surface:rootPackageJson",
								content: incoming,
								path: "package.json",
							},
							{
								artifactId: "project:surface:gitignore",
								content: lineIncoming,
								path: ".gitignore",
							},
						],
					}).pipe(Effect.provide(coreLayer)),
				),
			);

			expect(error).toMatchObject({
				_tag: "ApplyError",
				path: "managed surfaces",
				preflight: {
					conflicts: [
						{
							base: "tsc",
							forge: "tsc -b",
							label: "package.json -> scripts.build",
							user: "tsc --watch",
						},
						{
							base: "vite",
							forge: "vite --port 4000",
							label: "package.json -> scripts.dev",
							user: "vite --host",
						},
						{
							base: "dist/",
							forge: "output/",
							label: ".gitignore -> Build -> dist/",
							user: "build/",
						},
					],
					refusals: [],
				},
			});

			expect(error.message).toBe(
				'Semantic merge conflicts were found:\npackage.json -> scripts.build: base was "tsc", user has "tsc --watch", and forge wants "tsc -b".\npackage.json -> scripts.dev: base was "vite", user has "vite --host", and forge wants "vite --port 4000".\n.gitignore -> Build -> dist/: base was "dist/", user has "build/", and forge wants "output/".\nResolve each conflict, then run Forge again.',
			);

			expect(await readFile(join(directory, "package.json"), "utf-8")).toBe(
				user,
			);

			expect(await readFile(join(directory, ".gitignore"), "utf-8")).toBe(
				lineUser,
			);

			expect(await readFile(join(directory, ".forge/lock.json"), "utf-8")).toBe(
				beforeLock,
			);
		});
	});

	it("resolves only conflicted cells while preserving clean changes", async () => {
		const resolve = async (
			policy: "accept-forge" | "keep-user",
			expectedDev: string,
		) => {
			await withTempDir(
				`apply-cell-resolution-${policy}`,
				async (directory) => {
					const base =
						'{\n\t"scripts": {\n\t\t"build": "tsc",\n\t\t"dev": "vite"\n\t}\n}\n';

					const baseHash = await hashContent(base);
					const artifact: LockfileArtifact = {
						base: { hash: baseHash, mergeKind: "json", semanticsVersion: 1 },
						definitionIds: ["root"],
						hash: baseHash,
						kind: "surface",
						path: "package.json",
					};

					await Effect.runPromise(
						Apply.applyPlan(directory, {
							lockfile: {
								artifacts: { "project:surface:rootPackageJson": artifact },
							},
							manifest: { config: {}, installs: [], modules: {} },
							removals: [],
							writes: [
								{
									artifactId: "project:surface:rootPackageJson",
									content: base,
									path: "package.json",
								},
							],
						}).pipe(Effect.provide(coreLayer)),
					);

					await writeText(
						join(directory, "package.json"),
						'{\n\t"scripts": {\n\t\t"build": "tsc",\n\t\t"dev": "vite --host",\n\t\t"user": "custom"\n\t}\n}\n',
					);

					const incoming =
						'{\n\t"scripts": {\n\t\t"build": "tsc",\n\t\t"dev": "vite --port 4000",\n\t\t"test": "vitest"\n\t}\n}\n';

					const incomingHash = await hashContent(incoming);

					await Effect.runPromise(
						Apply.applyPlan(
							directory,
							{
								lockfile: {
									artifacts: {
										"project:surface:rootPackageJson": {
											...artifact,
											base: {
												hash: incomingHash,
												mergeKind: "json",
												semanticsVersion: 1,
											},
											hash: incomingHash,
										},
									},
								},
								manifest: { config: {}, installs: [], modules: {} },
								removals: [],
								writes: [
									{
										artifactId: "project:surface:rootPackageJson",
										content: incoming,
										path: "package.json",
									},
								],
							},
							{ resolutionPolicy: policy },
						).pipe(Effect.provide(coreLayer)),
					);

					expect(await readJson(join(directory, "package.json"))).toEqual({
						scripts: {
							build: "tsc",
							dev: expectedDev,
							test: "vitest",
							user: "custom",
						},
					});
				},
			);
		};

		await resolve("keep-user", "vite --host");
		await resolve("accept-forge", "vite --port 4000");
	});

	it("resolves semantic conflicts with mixed per-cell decisions", async () => {
		await withTempDir("apply-mixed-cell-resolution", async (directory) => {
			const artifactId = "project:surface:rootPackageJson";
			const lineArtifactId = "project:surface:gitignore";
			const base =
				'{\n\t"scripts": {\n\t\t"build": "tsc",\n\t\t"dev": "vite"\n\t}\n}\n';

			const baseHash = await hashContent(base);
			const artifact: LockfileArtifact = {
				base: { hash: baseHash, mergeKind: "json", semanticsVersion: 1 },
				definitionIds: ["root"],
				hash: baseHash,
				kind: "surface",
				path: "package.json",
			};

			const lineBase = "# Build\ndist/\n";
			const lineBaseHash = await hashContent(lineBase);
			const lineArtifact: LockfileArtifact = {
				base: {
					hash: lineBaseHash,
					mergeKind: "lines",
					semanticsVersion: 1,
				},
				definitionIds: ["root"],
				hash: lineBaseHash,
				kind: "surface",
				path: ".gitignore",
			};

			await Effect.runPromise(
				Apply.applyPlan(directory, {
					lockfile: {
						artifacts: {
							[artifactId]: artifact,
							[lineArtifactId]: lineArtifact,
						},
					},
					manifest: { config: {}, installs: [], modules: {} },
					removals: [],
					writes: [
						{ artifactId, content: base, path: "package.json" },
						{
							artifactId: lineArtifactId,
							content: lineBase,
							path: ".gitignore",
						},
					],
				}).pipe(Effect.provide(coreLayer)),
			);

			await writeText(
				join(directory, "package.json"),
				'{\n\t"scripts": {\n\t\t"build": "tsc --watch",\n\t\t"dev": "vite --host"\n\t}\n}\n',
			);

			await writeText(join(directory, ".gitignore"), "# Build\nbuild/\n");
			const incoming =
				'{\n\t"scripts": {\n\t\t"build": "tsc -b",\n\t\t"dev": "vite --port 4000"\n\t}\n}\n';

			const incomingHash = await hashContent(incoming);
			const lineIncoming = "# Build\noutput/\n";
			const lineIncomingHash = await hashContent(lineIncoming);

			await Effect.runPromise(
				Apply.applyPlan(
					directory,
					{
						lockfile: {
							artifacts: {
								[artifactId]: {
									...artifact,
									base: {
										hash: incomingHash,
										mergeKind: "json",
										semanticsVersion: 1,
									},
									hash: incomingHash,
								},
								[lineArtifactId]: {
									...lineArtifact,
									base: {
										hash: lineIncomingHash,
										mergeKind: "lines",
										semanticsVersion: 1,
									},
									hash: lineIncomingHash,
								},
							},
						},
						manifest: { config: {}, installs: [], modules: {} },
						removals: [],
						writes: [
							{ artifactId, content: incoming, path: "package.json" },
							{
								artifactId: lineArtifactId,
								content: lineIncoming,
								path: ".gitignore",
							},
						],
					},
					{
						conflictResolutions: {
							".gitignore -> Build -> dist/": { resolution: "user" },
							"package.json -> scripts.build": { resolution: "user" },
							"package.json -> scripts.dev": { resolution: "forge" },
						},
					},
				).pipe(Effect.provide(coreLayer)),
			);

			expect(await readJson(join(directory, "package.json"))).toEqual({
				scripts: {
					build: "tsc --watch",
					dev: "vite --port 4000",
				},
			});

			expect(await readFile(join(directory, ".gitignore"), "utf-8")).toBe(
				"# Build\nbuild/\n",
			);
		});
	});

	it("validates shown nested conflict values before resolving", async () => {
		const verify = async (
			name: string,
			expectedUser: unknown,
			expectedForge: unknown,
			shouldResolve: boolean,
		) => {
			await withTempDir(`apply-expected-values-${name}`, async (directory) => {
				const artifactId = "project:surface:config";
				const path = "config.json";
				const base = `${JSON.stringify({ value: [{ side: "base" }] })}\n`;

				const userValue = [{ local: true, side: "user" }];
				const forgeValue = [{ generated: true, side: "forge" }];
				const user = `${JSON.stringify({ value: userValue })}\n`;
				const incoming = `${JSON.stringify({ value: forgeValue })}\n`;

				const baseHash = await hashContent(base);
				const incomingHash = await hashContent(incoming);
				await Effect.runPromise(
					Apply.applyPlan(directory, {
						lockfile: {
							artifacts: {
								[artifactId]: {
									base: {
										hash: baseHash,
										mergeKind: "json",
										semanticsVersion: 1,
									},
									definitionIds: ["fixture"],
									hash: baseHash,
									kind: "surface",
									path,
								},
							},
						},
						manifest: { config: {}, installs: [], modules: {} },
						removals: [],
						writes: [{ artifactId, content: base, path }],
					}).pipe(Effect.provide(coreLayer)),
				);

				await writeText(join(directory, path), user);

				const result = await Effect.runPromise(
					Apply.applyPlan(
						directory,
						{
							lockfile: {
								artifacts: {
									[artifactId]: {
										base: {
											hash: incomingHash,
											mergeKind: "json",
											semanticsVersion: 1,
										},
										definitionIds: ["fixture"],
										hash: incomingHash,
										kind: "surface",
										path,
									},
								},
							},
							manifest: { config: {}, installs: [], modules: {} },
							removals: [],
							writes: [{ artifactId, content: incoming, path }],
						},
						{
							conflictResolutions: {
								"config.json -> value": {
									expected: {
										forge: expectedForge,
										user: expectedUser,
									},
									resolution: "user",
								},
							},
						},
					).pipe(
						Effect.match({
							onFailure: (error) => ({ error }),
							onSuccess: () => ({ success: true }),
						}),
						Effect.provide(coreLayer),
					),
				);

				if (shouldResolve) {
					expect(result).toEqual({ success: true });
					expect(await readJson(join(directory, path))).toEqual({
						value: userValue,
					});
				} else {
					expect(result).toEqual({
						error: expect.objectContaining({
							path: "managed surfaces",
						}),
					});

					expect(await readJson(join(directory, path))).toEqual({
						value: userValue,
					});
				}
			});
		};

		await verify(
			"equal",
			[{ local: true, side: "user" }],
			[{ generated: true, side: "forge" }],
			true,
		);

		await verify("array-length", [], [], false);
		await verify("object-size", [{ local: true }], [], false);
		await verify("object-key", [{ generated: true, side: "user" }], [], false);
		await verify("primitive", "user", [], false);
	});

	it("resolves a non-mergeable file by its path", async () => {
		await withTempDir("apply-file-resolution", async (directory) => {
			const artifactId = "project:file:managed.txt";
			const initial = "managed\n";
			const initialHash = await hashContent(initial);
			await Effect.runPromise(
				Apply.applyPlan(directory, {
					lockfile: {
						artifacts: {
							[artifactId]: {
								definitionIds: ["fixture"],
								hash: initialHash,
								kind: "file",
								path: "managed.txt",
							},
						},
					},
					manifest: { config: {}, installs: [], modules: {} },
					removals: [],
					writes: [{ artifactId, content: initial, path: "managed.txt" }],
				}).pipe(Effect.provide(coreLayer)),
			);

			await writeText(join(directory, "managed.txt"), "user\n");
			const incoming = "forge\n";
			const incomingHash = await hashContent(incoming);
			await Effect.runPromise(
				Apply.applyPlan(
					directory,
					{
						lockfile: {
							artifacts: {
								[artifactId]: {
									definitionIds: ["fixture"],
									hash: incomingHash,
									kind: "file",
									path: "managed.txt",
								},
							},
						},
						manifest: { config: {}, installs: [], modules: {} },
						removals: [],
						writes: [{ artifactId, content: incoming, path: "managed.txt" }],
					},
					{
						conflictResolutions: {
							"managed.txt": { resolution: "user" },
						},
					},
				).pipe(Effect.provide(coreLayer)),
			);

			expect(await readFile(join(directory, "managed.txt"), "utf-8")).toBe(
				"user\n",
			);
		});
	});

	it("fails loudly for unknown resolution labels", async () => {
		await withTempDir("apply-unknown-resolution", async (directory) => {
			const result = await Effect.runPromise(
				Apply.applyPlan(
					directory,
					{
						lockfile: { artifacts: {} },
						manifest: { config: {}, installs: [], modules: {} },
						removals: [],
						writes: [],
					},
					{
						conflictResolutions: {
							"missing -> value": { resolution: "user" },
						},
					},
				).pipe(
					Effect.match({
						onFailure: (error) => ({ error }),
						onSuccess: () => ({ success: true }),
					}),
					Effect.provide(coreLayer),
				),
			);

			expect(result).toEqual({
				error: expect.objectContaining({
					message: "Resolution Label Unknown: missing -> value",
					path: "missing -> value",
				}),
			});
		});
	});

	it("ignores prototype members when falling back to a policy", async () => {
		await withTempDir("apply-resolution-prototype", async (directory) => {
			const artifactId = "project:file:toString";
			const initial = "managed\n";
			const initialHash = await hashContent(initial);
			await Effect.runPromise(
				Apply.applyPlan(directory, {
					lockfile: {
						artifacts: {
							[artifactId]: {
								definitionIds: ["fixture"],
								hash: initialHash,
								kind: "file",
								path: "toString",
							},
						},
					},
					manifest: { config: {}, installs: [], modules: {} },
					removals: [],
					writes: [{ artifactId, content: initial, path: "toString" }],
				}).pipe(Effect.provide(coreLayer)),
			);

			await writeText(join(directory, "toString"), "user\n");
			const incoming = "forge\n";
			await Effect.runPromise(
				Apply.applyPlan(
					directory,
					{
						lockfile: {
							artifacts: {
								[artifactId]: {
									definitionIds: ["fixture"],
									hash: await hashContent(incoming),
									kind: "file",
									path: "toString",
								},
							},
						},
						manifest: { config: {}, installs: [], modules: {} },
						removals: [],
						writes: [{ artifactId, content: incoming, path: "toString" }],
					},
					{
						conflictResolutions: {},
						resolutionPolicy: "accept-forge",
					},
				).pipe(Effect.provide(coreLayer)),
			);

			expect(await readFile(join(directory, "toString"), "utf-8")).toBe(
				incoming,
			);
		});
	});

	it("keeps a resolved user cell durable without rewriting the file", async () => {
		await withTempDir("apply-cell-resolution-durable", async (directory) => {
			const base = '{\n\t"scripts": {\n\t\t"dev": "vite"\n\t}\n}\n';
			const baseHash = await hashContent(base);
			const artifact: LockfileArtifact = {
				base: { hash: baseHash, mergeKind: "json", semanticsVersion: 1 },
				definitionIds: ["root"],
				hash: baseHash,
				kind: "surface",
				path: "package.json",
			};

			await Effect.runPromise(
				Apply.applyPlan(directory, {
					lockfile: {
						artifacts: { "project:surface:rootPackageJson": artifact },
					},
					manifest: { config: {}, installs: [], modules: {} },
					removals: [],
					writes: [
						{
							artifactId: "project:surface:rootPackageJson",
							content: base,
							path: "package.json",
						},
					],
				}).pipe(Effect.provide(coreLayer)),
			);

			await writeText(
				join(directory, "package.json"),
				'{\n\t"scripts": {\n\t\t"dev": "vite --host"\n\t}\n}\n',
			);

			const incoming =
				'{\n\t"scripts": {\n\t\t"dev": "vite --port 4000",\n\t\t"test": "vitest"\n\t}\n}\n';

			const incomingHash = await hashContent(incoming);
			const nextPlan: ApplyPlan = {
				lockfile: {
					artifacts: {
						"project:surface:rootPackageJson": {
							...artifact,
							base: {
								hash: incomingHash,
								mergeKind: "json",
								semanticsVersion: 1,
							},
							hash: incomingHash,
						},
					},
				},
				manifest: { config: {}, installs: [], modules: {} },
				removals: [],
				writes: [
					{
						artifactId: "project:surface:rootPackageJson",
						content: incoming,
						path: "package.json",
					},
				],
			};

			await Effect.runPromise(
				Apply.applyPlan(directory, nextPlan, {
					resolutionPolicy: "keep-user",
				}).pipe(Effect.provide(coreLayer)),
			);

			const packagePath = join(directory, "package.json");
			const resolved = await readFile(packagePath, "utf-8");
			const inode = (await stat(packagePath)).ino;

			await Effect.runPromise(
				Apply.applyPlan(directory, nextPlan).pipe(Effect.provide(coreLayer)),
			);

			expect(await readFile(packagePath, "utf-8")).toBe(resolved);
			expect((await stat(packagePath)).ino).toBe(inode);
		});
	});

	it("reports concise section-entry conflict values", async () => {
		await withTempDir("apply-line-conflict", async (directory) => {
			const base = "# Build\ndist/\n";
			const baseHash = await hashContent(base);
			await writeText(join(directory, ".gitignore"), "# Build\nbuild/\n");
			await Effect.runPromise(
				Effect.gen(function* () {
					yield* State.writeBase(directory, baseHash, base);
					yield* State.writeLockfile(directory, {
						artifacts: {
							"project:surface:gitignore": {
								base: {
									hash: baseHash,
									mergeKind: "lines",
									semanticsVersion: 1,
								},
								definitionIds: ["gitignore"],
								hash: baseHash,
								kind: "surface",
								path: ".gitignore",
							},
						},
					});
				}).pipe(Effect.provide(coreLayer)),
			);

			const incoming = "# Build\noutput/\n";
			const incomingHash = await hashContent(incoming);
			const error = await Effect.runPromise(
				Effect.flip(
					Apply.applyPlan(directory, {
						lockfile: {
							artifacts: {
								"project:surface:gitignore": {
									base: {
										hash: incomingHash,
										mergeKind: "lines",
										semanticsVersion: 1,
									},
									definitionIds: ["gitignore"],
									hash: incomingHash,
									kind: "surface",
									path: ".gitignore",
								},
							},
						},
						manifest: { config: {}, installs: [], modules: {} },
						removals: [],
						writes: [
							{
								artifactId: "project:surface:gitignore",
								content: incoming,
								path: ".gitignore",
							},
						],
					}).pipe(Effect.provide(coreLayer)),
				),
			);

			expect(error.message).toBe(
				'Semantic merge conflicts were found:\n.gitignore -> Build -> dist/: base was "dist/", user has "build/", and forge wants "output/".\nResolve each conflict, then run Forge again.',
			);

			expect(await readFile(join(directory, ".gitignore"), "utf-8")).toBe(
				"# Build\nbuild/\n",
			);
		});
	});

	it("pairs repeated section conflict labels with their own values", async () => {
		await withTempDir("apply-repeated-line-conflicts", async (directory) => {
			const base = "# Build\nsame\nanchor\nsame\n";
			const baseHash = await hashContent(base);
			await writeText(
				join(directory, ".gitignore"),
				"# Build\nuser-one\nanchor\nuser-two\n",
			);

			await Effect.runPromise(
				Effect.gen(function* () {
					yield* State.writeBase(directory, baseHash, base);
					yield* State.writeLockfile(directory, {
						artifacts: {
							"project:surface:gitignore": {
								base: {
									hash: baseHash,
									mergeKind: "lines",
									semanticsVersion: 1,
								},
								definitionIds: ["gitignore"],
								hash: baseHash,
								kind: "surface",
								path: ".gitignore",
							},
						},
					});
				}).pipe(Effect.provide(coreLayer)),
			);

			const incoming = "# Build\nforge-one\nanchor\nforge-two\n";
			const incomingHash = await hashContent(incoming);
			const error = await Effect.runPromise(
				Effect.flip(
					Apply.applyPlan(directory, {
						lockfile: {
							artifacts: {
								"project:surface:gitignore": {
									base: {
										hash: incomingHash,
										mergeKind: "lines",
										semanticsVersion: 1,
									},
									definitionIds: ["gitignore"],
									hash: incomingHash,
									kind: "surface",
									path: ".gitignore",
								},
							},
						},
						manifest: { config: {}, installs: [], modules: {} },
						removals: [],
						writes: [
							{
								artifactId: "project:surface:gitignore",
								content: incoming,
								path: ".gitignore",
							},
						],
					}).pipe(Effect.provide(coreLayer)),
				),
			);

			expect(error.message).toContain('user has "user-one"');
			expect(error.message).toContain('user has "user-two"');
			expect(error.message).toContain('forge wants "forge-one"');
			expect(error.message).toContain('forge wants "forge-two"');
		});
	});

	it("aggregates non-mergeable refusals before failing", async () => {
		await withTempDir("apply-refusal-aggregation", async (directory) => {
			const firstPath = "apps/web/app/layout.tsx";
			const secondPath = "packages/db/src/index.ts";
			await writeText(join(directory, firstPath), "user one\n");
			await writeText(join(directory, secondPath), "user two\n");
			await Effect.runPromise(
				State.writeLockfile(directory, {
					artifacts: {
						first: {
							definitionIds: ["fixture"],
							hash: await hashContent("forge one\n"),
							kind: "file",
							path: firstPath,
						},
						second: {
							definitionIds: ["fixture"],
							hash: await hashContent("forge two\n"),
							kind: "file",
							path: secondPath,
						},
					},
				}).pipe(Effect.provide(coreLayer)),
			);

			const error = await Effect.runPromise(
				Effect.flip(
					Apply.applyPlan(directory, {
						lockfile: { artifacts: {} },
						manifest: { config: {}, installs: [], modules: {} },
						removals: [],
						writes: [
							{ content: "next one\n", path: firstPath },
							{ content: "next two\n", path: secondPath },
						],
					}).pipe(Effect.provide(coreLayer)),
				),
			);

			expect(error).toMatchObject({ path: "managed files" });
			expect(error.message).toContain(firstPath);
			expect(error.message).toContain(secondPath);
		});
	});

	it("preserves user residue when a managed surface is removed", async () => {
		await withTempDir("apply-surface-removal", async (directory) => {
			const base = "# Build\ndist/\n";
			const hash = await hashContent(base);
			await Effect.runPromise(
				Apply.applyPlan(directory, {
					lockfile: {
						artifacts: {
							"project:surface:gitignore": {
								base: { hash, mergeKind: "lines", semanticsVersion: 1 },
								definitionIds: ["gitignore"],
								hash,
								kind: "surface",
								path: ".gitignore",
							},
						},
					},
					manifest: { config: {}, installs: [], modules: {} },
					removals: [],
					writes: [
						{
							artifactId: "project:surface:gitignore",
							content: base,
							path: ".gitignore",
						},
					],
				}).pipe(Effect.provide(coreLayer)),
			);

			await writeText(
				join(directory, ".gitignore"),
				"# Build\ndist/\nuser-only/\n",
			);

			const incoming = "# Build\ndist/\ncoverage/\n";
			const incomingHash = await hashContent(incoming);
			await Effect.runPromise(
				Apply.applyPlan(directory, {
					lockfile: {
						artifacts: {
							"project:surface:gitignore": {
								base: {
									hash: incomingHash,
									mergeKind: "lines",
									semanticsVersion: 1,
								},
								definitionIds: ["gitignore"],
								hash: incomingHash,
								kind: "surface",
								path: ".gitignore",
							},
						},
					},
					manifest: { config: {}, installs: [], modules: {} },
					removals: [],
					writes: [
						{
							artifactId: "project:surface:gitignore",
							content: incoming,
							path: ".gitignore",
						},
					],
				}).pipe(Effect.provide(coreLayer)),
			);

			expect(await readFile(join(directory, ".gitignore"), "utf-8")).toBe(
				"# Build\ndist/\nuser-only/\ncoverage/\n",
			);

			await Effect.runPromise(
				Apply.applyPlan(directory, {
					lockfile: { artifacts: {} },
					manifest: { config: {}, installs: [], modules: {} },
					removals: [".gitignore"],
					writes: [],
				}).pipe(Effect.provide(coreLayer)),
			);

			expect(await readFile(join(directory, ".gitignore"), "utf-8")).toBe(
				"# Build\nuser-only/\n",
			);
		});
	});

	it("refuses corrupt existing bases before mutating managed files", async () => {
		await withTempDir("apply-corrupt-incoming-base", async (directory) => {
			const oldContent = '{\n\t"name": "old"\n}\n';
			const oldHash = await hashContent(oldContent);
			await writeText(join(directory, "package.json"), oldContent);
			await Effect.runPromise(
				Effect.gen(function* () {
					yield* State.writeLockfile(directory, {
						artifacts: {
							"project:surface:rootPackageJson": {
								definitionIds: ["root"],
								hash: oldHash,
								kind: "surface",
								path: "package.json",
							},
						},
					});

					yield* State.writeManifest(directory, {
						config: { version: "old" },
						installs: [],
						modules: {},
					});
				}).pipe(Effect.provide(coreLayer)),
			);

			const nextContent = '{\n\t"name": "next"\n}\n';
			const nextHash = await hashContent(nextContent);
			await writeText(join(directory, ".forge/bases", nextHash), "corrupt\n");
			const oldLock = await readFile(
				join(directory, ".forge/lock.json"),
				"utf-8",
			);

			const oldManifest = await readFile(
				join(directory, ".forge/manifest.json"),
				"utf-8",
			);

			const error = await Effect.runPromise(
				Effect.flip(
					Apply.applyPlan(directory, {
						lockfile: {
							artifacts: {
								"project:surface:rootPackageJson": {
									base: {
										hash: nextHash,
										mergeKind: "json",
										semanticsVersion: 1,
									},
									definitionIds: ["root"],
									hash: nextHash,
									kind: "surface",
									path: "package.json",
								},
							},
						},
						manifest: {
							config: { version: "next" },
							installs: [],
							modules: {},
						},
						removals: [],
						writes: [
							{
								artifactId: "project:surface:rootPackageJson",
								content: nextContent,
								path: "package.json",
							},
						],
					}).pipe(Effect.provide(coreLayer)),
				),
			);

			expect(error).toMatchObject({ message: "Managed Base Hash Mismatch" });
			expect(await readFile(join(directory, "package.json"), "utf-8")).toBe(
				oldContent,
			);

			expect(await readFile(join(directory, ".forge/lock.json"), "utf-8")).toBe(
				oldLock,
			);

			expect(
				await readFile(join(directory, ".forge/manifest.json"), "utf-8"),
			).toBe(oldManifest);
		});
	});

	it("refuses secret-bearing .env bases before writing files or blobs", async () => {
		await withTempDir("apply-env-base-forbidden", async (directory) => {
			const content = "SECRET=generated\n";
			const hash = await hashContent(content);
			const error = await Effect.runPromise(
				Effect.flip(
					Apply.applyPlan(directory, {
						lockfile: {
							artifacts: {
								"project:surface:rootEnv": {
									base: { hash, mergeKind: "env", semanticsVersion: 1 },
									definitionIds: ["malformed"],
									hash,
									kind: "surface",
									path: ".env",
								},
							},
						},
						manifest: { config: {}, installs: [], modules: {} },
						removals: [],
						writes: [
							{
								artifactId: "project:surface:rootEnv",
								content,
								path: ".env",
							},
						],
					}).pipe(Effect.provide(coreLayer)),
				),
			);

			expect(error).toMatchObject({
				message: "Managed Base Forbidden",
				path: ".env",
			});

			expect(await pathExists(join(directory, ".env"))).toBe(false);
			expect(await pathExists(join(directory, ".forge/bases", hash))).toBe(
				false,
			);
		});
	});

	it("leaves old state replayable when a crash interrupts atomic file commits", async () => {
		await withTempDir("apply-crash-replay", async (directory) => {
			const packageBase = '{\n\t"name": "old"\n}\n';
			const gitignoreBase = "# Build\ndist/\n";
			const packageHash = await hashContent(packageBase);
			const gitignoreHash = await hashContent(gitignoreBase);
			const initialPlan: ApplyPlan = {
				lockfile: {
					artifacts: {
						"project:surface:rootPackageJson": {
							base: {
								hash: packageHash,
								mergeKind: "json",
								semanticsVersion: 1,
							},
							definitionIds: ["root"],
							hash: packageHash,
							kind: "surface",
							path: "package.json",
						},
						"project:surface:gitignore": {
							base: {
								hash: gitignoreHash,
								mergeKind: "lines",
								semanticsVersion: 1,
							},
							definitionIds: ["gitignore"],
							hash: gitignoreHash,
							kind: "surface",
							path: ".gitignore",
						},
					},
				},
				manifest: { config: { version: 1 }, installs: [], modules: {} },
				removals: [],
				writes: [
					{
						artifactId: "project:surface:rootPackageJson",
						content: packageBase,
						path: "package.json",
					},
					{
						artifactId: "project:surface:gitignore",
						content: gitignoreBase,
						path: ".gitignore",
					},
				],
			};

			await Effect.runPromise(
				Apply.applyPlan(directory, initialPlan).pipe(Effect.provide(coreLayer)),
			);

			const oldLock = await readFile(
				join(directory, ".forge/lock.json"),
				"utf-8",
			);

			const packageIncoming = '{\n\t"name": "new"\n}\n';
			const gitignoreIncoming = "# Build\ndist/\ncoverage/\n";
			const nextPlan: ApplyPlan = {
				lockfile: {
					artifacts: {
						"project:surface:rootPackageJson": {
							base: {
								hash: await hashContent(packageIncoming),
								mergeKind: "json",
								semanticsVersion: 1,
							},
							definitionIds: ["root"],
							hash: await hashContent(packageIncoming),
							kind: "surface",
							path: "package.json",
						},
						"project:surface:gitignore": {
							base: {
								hash: await hashContent(gitignoreIncoming),
								mergeKind: "lines",
								semanticsVersion: 1,
							},
							definitionIds: ["gitignore"],
							hash: await hashContent(gitignoreIncoming),
							kind: "surface",
							path: ".gitignore",
						},
					},
				},
				manifest: { config: { version: 2 }, installs: [], modules: {} },
				removals: [],
				writes: [
					{
						artifactId: "project:surface:rootPackageJson",
						content: packageIncoming,
						path: "package.json",
					},
					{
						artifactId: "project:surface:gitignore",
						content: gitignoreIncoming,
						path: ".gitignore",
					},
				],
			};

			let committedFiles = 0;
			const failingFileSystem = Layer.effect(
				FileSystem.FileSystem,
				Effect.map(FileSystem.FileSystem, (fileSystem) => ({
					...fileSystem,
					rename: (oldPath: string, newPath: string) => {
						if (
							oldPath.includes("/.staging-") &&
							!newPath.includes("/.forge/")
						) {
							committedFiles++;
							if (committedFiles === 2) return Effect.die("simulated crash");
						}

						return fileSystem.rename(oldPath, newPath);
					},
				})),
			).pipe(Layer.provide(NodeServices.layer));

			const crashingLayer = Layer.mergeAll(
				Apply.Default.pipe(
					Layer.provide(
						Layer.succeed(CliVersion, { version: "test-cli-version" }),
					),
				),
				State.Default.pipe(
					Layer.provide(
						Layer.succeed(CliVersion, { version: "test-cli-version" }),
					),
				),
			).pipe(Layer.provide(failingFileSystem));

			const crashed = await Effect.runPromiseExit(
				Apply.applyPlan(directory, nextPlan).pipe(
					Effect.provide(crashingLayer),
				),
			);

			expect(crashed._tag).toBe("Failure");
			expect(await readFile(join(directory, ".forge/lock.json"), "utf-8")).toBe(
				oldLock,
			);

			await Effect.runPromise(
				Apply.applyPlan(directory, nextPlan).pipe(Effect.provide(coreLayer)),
			);

			expect(await readFile(join(directory, "package.json"), "utf-8")).toBe(
				packageIncoming,
			);

			expect(await readFile(join(directory, ".gitignore"), "utf-8")).toBe(
				gitignoreIncoming,
			);

			const manifest = await readJson<{ config: { version: number } }>(
				join(directory, ".forge/manifest.json"),
			);

			expect(manifest.config.version).toBe(2);
		});
	});

	it("publishes manifest and lockfile through one atomic state boundary", async () => {
		await withTempDir("apply-state-boundary", async (directory) => {
			const oldContent = "old\n";
			const newContent = "new\n";
			const artifactId = "project:file:managed.txt";
			const planFor = async (
				content: string,
				version: number,
			): Promise<ApplyPlan> => ({
				lockfile: {
					artifacts: {
						[artifactId]: {
							definitionIds: ["fixture"],
							hash: await hashContent(content),
							kind: "file",
							path: "managed.txt",
						},
					},
				},
				manifest: { config: { version }, installs: [], modules: {} },
				removals: [],
				writes: [{ artifactId, content, path: "managed.txt" }],
			});

			await Effect.runPromise(
				Apply.applyPlan(directory, await planFor(oldContent, 1)).pipe(
					Effect.provide(coreLayer),
				),
			);

			const failingFileSystem = Layer.effect(
				FileSystem.FileSystem,
				Effect.map(FileSystem.FileSystem, (fileSystem) => ({
					...fileSystem,
					rename: (oldPath: string, newPath: string) =>
						newPath.endsWith("/.forge/lock.json")
							? Effect.die("simulated state crash")
							: fileSystem.rename(oldPath, newPath),
				})),
			).pipe(Layer.provide(NodeServices.layer));

			const crashingLayer = Layer.mergeAll(
				Apply.Default.pipe(
					Layer.provide(
						Layer.succeed(CliVersion, { version: "test-cli-version" }),
					),
				),
				State.Default.pipe(
					Layer.provide(
						Layer.succeed(CliVersion, { version: "test-cli-version" }),
					),
				),
			).pipe(Layer.provide(failingFileSystem));

			const nextPlan = await planFor(newContent, 2);
			const crashed = await Effect.runPromiseExit(
				Apply.applyPlan(directory, nextPlan).pipe(
					Effect.provide(crashingLayer),
				),
			);

			expect(crashed._tag).toBe("Failure");
			expect(
				await Effect.runPromise(
					State.readManifest(directory).pipe(Effect.provide(coreLayer)),
				),
			).toMatchObject({ config: { version: 1 } });

			expect(
				await Effect.runPromise(
					State.readLockfile(directory).pipe(Effect.provide(coreLayer)),
				),
			).toMatchObject({
				artifacts: { [artifactId]: { hash: await hashContent(oldContent) } },
			});

			await Effect.runPromise(
				Apply.applyPlan(directory, nextPlan).pipe(Effect.provide(coreLayer)),
			);

			expect(await readFile(join(directory, "managed.txt"), "utf-8")).toBe(
				newContent,
			);

			expect(
				await Effect.runPromise(
					State.readManifest(directory).pipe(Effect.provide(coreLayer)),
				),
			).toMatchObject({ config: { version: 2 } });
		});
	});

	it("keeps committed state successful when post-commit base GC fails", async () => {
		await withTempDir("apply-best-effort-gc", async (directory) => {
			const artifactId = "project:surface:gitignore";
			const planFor = async (content: string): Promise<ApplyPlan> => {
				const hash = await hashContent(content);
				return {
					lockfile: {
						artifacts: {
							[artifactId]: {
								base: { hash, mergeKind: "lines", semanticsVersion: 1 },
								definitionIds: ["gitignore"],
								hash,
								kind: "surface",
								path: ".gitignore",
							},
						},
					},
					manifest: { config: {}, installs: [], modules: {} },
					removals: [],
					writes: [{ artifactId, content, path: ".gitignore" }],
				};
			};

			const oldContent = "# Build\nold/\n";
			const nextContent = "# Build\nnext/\n";
			const oldHash = await hashContent(oldContent);
			const oldBasePath = join(directory, ".forge/bases", oldHash);
			await Effect.runPromise(
				Apply.applyPlan(directory, await planFor(oldContent)).pipe(
					Effect.provide(coreLayer),
				),
			);

			const failingFileSystem = Layer.effect(
				FileSystem.FileSystem,
				Effect.map(FileSystem.FileSystem, (fileSystem) => ({
					...fileSystem,
					remove: (
						path: string,
						options?: Parameters<FileSystem.FileSystem["remove"]>[1],
					) =>
						path === oldBasePath
							? Effect.fail(
									PlatformError.systemError({
										method: "remove",
										module: "FileSystem",
										pathOrDescriptor: path,
										_tag: "PermissionDenied",
									}),
								)
							: fileSystem.remove(path, options),
				})),
			).pipe(Layer.provide(NodeServices.layer));

			const gcFailingLayer = Layer.mergeAll(
				Apply.Default.pipe(
					Layer.provide(
						Layer.succeed(CliVersion, { version: "test-cli-version" }),
					),
				),
				State.Default.pipe(
					Layer.provide(
						Layer.succeed(CliVersion, { version: "test-cli-version" }),
					),
				),
			).pipe(Layer.provide(failingFileSystem));

			await Effect.runPromise(
				Apply.applyPlan(directory, await planFor(nextContent)).pipe(
					Effect.provide(gcFailingLayer),
				),
			);

			expect(await pathExists(oldBasePath)).toBe(true);
			expect(await readFile(join(directory, ".gitignore"), "utf-8")).toBe(
				nextContent,
			);

			await Effect.runPromise(
				Apply.applyPlan(directory, await planFor(nextContent)).pipe(
					Effect.provide(coreLayer),
				),
			);

			expect(await pathExists(oldBasePath)).toBe(false);
		});
	});

	it("seeds a legacy base only from hash-matching disk content", async () => {
		await withTempDir("apply-legacy-base", async (directory) => {
			const base = '{\n\t"scripts": {\n\t\t"dev": "vite"\n\t}\n}\n';
			const baseHash = await hashContent(base);
			await writeText(join(directory, "package.json"), base);
			await Effect.runPromise(
				State.writeLockfile(directory, {
					artifacts: {
						"project:surface:rootPackageJson": {
							definitionIds: ["root"],
							hash: baseHash,
							kind: "surface",
							path: "package.json",
						},
					},
				}).pipe(Effect.provide(coreLayer)),
			);

			const seededPlan: ApplyPlan = {
				lockfile: {
					artifacts: {
						"project:surface:rootPackageJson": {
							base: {
								hash: baseHash,
								mergeKind: "json",
								semanticsVersion: 1,
							},
							definitionIds: ["root"],
							hash: baseHash,
							kind: "surface",
							path: "package.json",
						},
					},
				},
				manifest: { config: {}, installs: [], modules: {} },
				removals: [],
				writes: [
					{
						artifactId: "project:surface:rootPackageJson",
						content: base,
						path: "package.json",
					},
				],
			};

			await Effect.runPromise(
				Apply.applyPlan(directory, seededPlan).pipe(Effect.provide(coreLayer)),
			);

			expect(
				await readFile(join(directory, ".forge/bases", baseHash), "utf-8"),
			).toBe(base);

			await writeText(
				join(directory, "package.json"),
				'{\n\t"scripts": {\n\t\t"dev": "vite --host"\n\t}\n}\n',
			);

			const incoming =
				'{\n\t"scripts": {\n\t\t"dev": "vite",\n\t\t"test": "vitest"\n\t}\n}\n';

			const incomingHash = await hashContent(incoming);
			await Effect.runPromise(
				Apply.applyPlan(directory, {
					...seededPlan,
					lockfile: {
						artifacts: {
							"project:surface:rootPackageJson": {
								base: {
									hash: incomingHash,
									mergeKind: "json",
									semanticsVersion: 1,
								},
								definitionIds: ["root", "vitest"],
								hash: incomingHash,
								kind: "surface",
								path: "package.json",
							},
						},
					},
					writes: [
						{
							artifactId: "project:surface:rootPackageJson",
							content: incoming,
							path: "package.json",
						},
					],
				}).pipe(Effect.provide(coreLayer)),
			);

			expect(await readJson(join(directory, "package.json"))).toEqual({
				scripts: { dev: "vite --host", test: "vitest" },
			});
		});
	});

	it("adopts identical renders only with compatible stored descriptors", async () => {
		await withTempDir("apply-identical-descriptors", async (scratch) => {
			const incoming = "# Build\ndist/\n";
			const incomingHash = await hashContent(incoming);
			const makePlan = (
				mergeKind: "json" | "lines",
				semanticsVersion: number,
			) =>
				({
					lockfile: {
						artifacts: {
							"project:surface:gitignore": {
								base: { hash: incomingHash, mergeKind, semanticsVersion },
								definitionIds: ["gitignore"],
								hash: incomingHash,
								kind: "surface",
								path: ".gitignore",
							},
						},
					},
					manifest: { config: {}, installs: [], modules: {} },
					removals: [],
					writes: [
						{
							artifactId: "project:surface:gitignore",
							content: incoming,
							path: ".gitignore",
						},
					],
				}) satisfies ApplyPlan;

			const fresh = join(scratch, "fresh");
			await writeText(join(fresh, ".gitignore"), incoming);
			await Effect.runPromise(
				Apply.applyPlan(fresh, makePlan("lines", 1)).pipe(
					Effect.provide(coreLayer),
				),
			);

			const legacy = join(scratch, "legacy");
			await writeText(join(legacy, ".gitignore"), incoming);
			await Effect.runPromise(
				State.writeLockfile(legacy, {
					artifacts: {
						"project:surface:gitignore": {
							definitionIds: ["gitignore"],
							hash: await hashContent("# Build\nold/\n"),
							kind: "surface",
							path: ".gitignore",
						},
					},
				}).pipe(Effect.provide(coreLayer)),
			);

			await Effect.runPromise(
				Apply.applyPlan(legacy, makePlan("lines", 1)).pipe(
					Effect.provide(coreLayer),
				),
			);

			const matching = join(scratch, "matching");
			const matchingBase = "# Build\nold/\n";
			const matchingBaseHash = await hashContent(matchingBase);
			await writeText(join(matching, ".gitignore"), incoming);
			await Effect.runPromise(
				Effect.gen(function* () {
					yield* State.writeBase(matching, matchingBaseHash, matchingBase);
					yield* State.writeLockfile(matching, {
						artifacts: {
							"project:surface:gitignore": {
								base: {
									hash: matchingBaseHash,
									mergeKind: "lines",
									semanticsVersion: 1,
								},
								definitionIds: ["gitignore"],
								hash: matchingBaseHash,
								kind: "surface",
								path: ".gitignore",
							},
						},
					});
				}).pipe(Effect.provide(coreLayer)),
			);

			await Effect.runPromise(
				Apply.applyPlan(matching, makePlan("lines", 1)).pipe(
					Effect.provide(coreLayer),
				),
			);

			const mismatchCases: ReadonlyArray<
				readonly [string, "json" | "lines", number]
			> = [
				["kind", "json", 1],
				["version", "lines", 99],
			];

			for (const [name, storedKind, storedVersion] of mismatchCases) {
				const directory = join(scratch, name);
				const old = "# Build\nold/\n";
				const oldHash = await hashContent(old);
				await writeText(join(directory, ".gitignore"), incoming);
				await Effect.runPromise(
					Effect.gen(function* () {
						yield* State.writeBase(directory, oldHash, old);
						yield* State.writeLockfile(directory, {
							artifacts: {
								"project:surface:gitignore": {
									base: {
										hash: oldHash,
										mergeKind: storedKind,
										semanticsVersion: storedVersion,
									},
									definitionIds: ["gitignore"],
									hash: oldHash,
									kind: "surface",
									path: ".gitignore",
								},
							},
						});
					}).pipe(Effect.provide(coreLayer)),
				);

				const error = await Effect.runPromise(
					Effect.flip(
						Apply.applyPlan(directory, makePlan("lines", 1)).pipe(
							Effect.provide(coreLayer),
						),
					),
				);

				expect(error).toMatchObject({ message: "Managed File Modified" });
			}
		});
	});

	it("keeps refusal semantics for edited legacy and mismatched-version surfaces", async () => {
		await withTempDir("apply-legacy-refusal", async (directory) => {
			const base = '{\n\t"name": "base"\n}\n';
			const baseHash = await hashContent(base);
			await writeText(
				join(directory, "package.json"),
				'{\n\t"name": "user"\n}\n',
			);

			await Effect.runPromise(
				State.writeLockfile(directory, {
					artifacts: {
						"project:surface:rootPackageJson": {
							definitionIds: ["root"],
							hash: baseHash,
							kind: "surface",
							path: "package.json",
						},
					},
				}).pipe(Effect.provide(coreLayer)),
			);

			const incoming = '{\n\t"name": "forge"\n}\n';
			const incomingHash = await hashContent(incoming);
			const plan: ApplyPlan = {
				lockfile: {
					artifacts: {
						"project:surface:rootPackageJson": {
							base: {
								hash: incomingHash,
								mergeKind: "json",
								semanticsVersion: 1,
							},
							definitionIds: ["root"],
							hash: incomingHash,
							kind: "surface",
							path: "package.json",
						},
					},
				},
				manifest: { config: {}, installs: [], modules: {} },
				removals: [],
				writes: [
					{
						artifactId: "project:surface:rootPackageJson",
						content: incoming,
						path: "package.json",
					},
				],
			};

			const legacyError = await Effect.runPromise(
				Effect.flip(
					Apply.applyPlan(directory, plan).pipe(Effect.provide(coreLayer)),
				),
			);

			expect(legacyError).toMatchObject({ message: "Managed File Modified" });

			await Effect.runPromise(
				State.writeBase(directory, baseHash, base).pipe(
					Effect.provide(coreLayer),
				),
			);

			await Effect.runPromise(
				State.writeLockfile(directory, {
					artifacts: {
						"project:surface:rootPackageJson": {
							base: {
								hash: baseHash,
								mergeKind: "json",
								semanticsVersion: 99,
							},
							definitionIds: ["root"],
							hash: baseHash,
							kind: "surface",
							path: "package.json",
						},
					},
				}).pipe(Effect.provide(coreLayer)),
			);

			const versionError = await Effect.runPromise(
				Effect.flip(
					Apply.applyPlan(directory, plan).pipe(Effect.provide(coreLayer)),
				),
			);

			expect(versionError).toMatchObject({ message: "Managed File Modified" });
			const keepUserError = await Effect.runPromise(
				Effect.flip(
					Apply.applyPlan(directory, plan, {
						resolutionPolicy: "keep-user",
					}).pipe(Effect.provide(coreLayer)),
				),
			);

			expect(keepUserError).toMatchObject({
				message: "Managed File Modified",
			});
		});
	});

	it("keeps edited JSONC tsconfig surfaces on hash-refusal semantics", async () => {
		await withTempDir("apply-jsonc-refusal", async (directory) => {
			const base = '{\n\t"compilerOptions": {}\n}\n';
			await writeText(
				join(directory, "apps/web/tsconfig.json"),
				'{\n\t// user comment\n\t"compilerOptions": {}\n}\n',
			);

			await Effect.runPromise(
				State.writeLockfile(directory, {
					artifacts: {
						"module:abcde:surface:tsconfig": {
							definitionIds: ["nextjs/tsconfig"],
							hash: await hashContent(base),
							kind: "surface",
							path: "apps/web/tsconfig.json",
						},
					},
				}).pipe(Effect.provide(coreLayer)),
			);

			const error = await Effect.runPromise(
				Effect.flip(
					Apply.applyPlan(directory, {
						lockfile: { artifacts: {} },
						manifest: { config: {}, installs: [], modules: {} },
						removals: [],
						writes: [
							{
								artifactId: "module:abcde:surface:tsconfig",
								content: '{\n\t"compilerOptions": { "strict": true }\n}\n',
								path: "apps/web/tsconfig.json",
							},
						],
					}).pipe(Effect.provide(coreLayer)),
				),
			);

			expect(error).toMatchObject({
				message: "Managed File Modified",
				path: "apps/web/tsconfig.json",
			});
		});
	});

	it("reports comments in managed JSON surfaces as user modifications", async () => {
		await withTempDir("apply-json-comment-refusal", async (directory) => {
			const base = '{\n\t"tasks": {}\n}\n';
			const baseHash = await hashContent(base);
			await writeText(
				join(directory, "turbo.json"),
				'{\n\t// user comment\n\t"tasks": {}\n}\n',
			);

			await Effect.runPromise(
				Effect.gen(function* () {
					yield* State.writeBase(directory, baseHash, base);
					yield* State.writeLockfile(directory, {
						artifacts: {
							"project:surface:turboConfig": {
								base: {
									hash: baseHash,
									mergeKind: "json",
									semanticsVersion: 1,
								},
								definitionIds: ["turbo"],
								hash: baseHash,
								kind: "surface",
								path: "turbo.json",
							},
						},
					});
				}).pipe(Effect.provide(coreLayer)),
			);

			const incoming = '{\n\t"tasks": { "build": {} }\n}\n';
			const incomingHash = await hashContent(incoming);
			const error = await Effect.runPromise(
				Effect.flip(
					Apply.applyPlan(directory, {
						lockfile: {
							artifacts: {
								"project:surface:turboConfig": {
									base: {
										hash: incomingHash,
										mergeKind: "json",
										semanticsVersion: 1,
									},
									definitionIds: ["turbo"],
									hash: incomingHash,
									kind: "surface",
									path: "turbo.json",
								},
							},
						},
						manifest: { config: {}, installs: [], modules: {} },
						removals: [],
						writes: [
							{
								artifactId: "project:surface:turboConfig",
								content: incoming,
								path: "turbo.json",
							},
						],
					}).pipe(Effect.provide(coreLayer)),
				),
			);

			expect(error).toMatchObject({
				message: "Managed File Modified",
				path: "turbo.json",
			});

			if (!(error instanceof ApplyError))
				throw new Error("Expected ApplyError");

			expect(formatApplyError(error)).toBe(
				"Forge cannot safely update these files:\nturbo.json was modified after Forge last managed it.\nRun again with --keep-user to keep your version wherever you and Forge disagree, or --accept-forge to take Forge's version and overwrite yours.",
			);
		});
	});

	it("refuses to overwrite a modified managed file", async () => {
		await withTempDir("apply-overwrite", async (directory) => {
			await writeText(`${directory}/apps/web/app/layout.tsx`, "user-change\n");

			const previousLockfile: Lockfile = {
				schemaVersion: 1,
				artifacts: {
					"project:file:apps/web/app/layout.tsx": {
						definitionIds: ["nextjs/base"],
						hash: await hashContent("old-managed\n"),
						kind: "file",
						path: "apps/web/app/layout.tsx",
					},
				},
			};

			await Effect.runPromise(
				State.writeLockfile(directory, previousLockfile).pipe(
					Effect.provide(coreLayer),
				),
			);

			const error = await Effect.runPromise(
				Effect.flip(
					Apply.applyPlan(directory, {
						lockfile: { artifacts: {} },
						manifest: { config: {}, installs: [], modules: {} },
						removals: [],
						writes: [
							{
								content: "new-managed\n",
								path: "apps/web/app/layout.tsx",
							},
						],
					}).pipe(Effect.provide(coreLayer)),
				),
			);

			expect(error).toMatchObject({
				_tag: "ApplyError",
				message: "Managed File Modified",
				path: "apps/web/app/layout.tsx",
			});

			expect(
				await readFile(`${directory}/apps/web/app/layout.tsx`, "utf-8"),
			).toBe("user-change\n");

			expect(await readJson(join(directory, ".forge/lock.json"))).toEqual(
				previousLockfile,
			);

			expect(await pathExists(join(directory, ".forge/manifest.json"))).toBe(
				false,
			);
		});
	});

	it("resolves modified non-mergeable files according to policy", async () => {
		const resolve = async (policy: "accept-forge" | "keep-user") => {
			await withTempDir(
				`apply-managed-resolution-${policy}`,
				async (directory) => {
					const artifactId = "project:file:config.txt";
					const oldContent = "old-managed\n";
					const userContent = "user-change\n";
					const forgeContent = "new-managed\n";
					await writeText(join(directory, "config.txt"), userContent);
					await Effect.runPromise(
						State.writeLockfile(directory, {
							artifacts: {
								[artifactId]: {
									definitionIds: ["test"],
									hash: await hashContent(oldContent),
									kind: "file",
									path: "config.txt",
								},
							},
						}).pipe(Effect.provide(coreLayer)),
					);

					const plan: ApplyPlan = {
						lockfile: {
							artifacts: {
								[artifactId]: {
									definitionIds: ["test"],
									hash: await hashContent(forgeContent),
									kind: "file",
									path: "config.txt",
								},
							},
						},
						manifest: { config: {}, installs: [], modules: {} },
						removals: [],
						writes: [
							{
								artifactId,
								content: forgeContent,
								path: "config.txt",
							},
						],
					};

					await Effect.runPromise(
						Apply.applyPlan(directory, plan, {
							resolutionPolicy: policy,
						}).pipe(Effect.provide(coreLayer)),
					);

					const expected = policy === "keep-user" ? userContent : forgeContent;
					expect(await readFile(join(directory, "config.txt"), "utf-8")).toBe(
						expected,
					);

					const lockfile = await readJson(join(directory, ".forge/lock.json"));
					expect(lockfile).toMatchObject({
						artifacts: { [artifactId]: { hash: await hashContent(expected) } },
					});

					if (policy === "keep-user") {
						await Effect.runPromise(
							Apply.applyPlan(directory, plan).pipe(Effect.provide(coreLayer)),
						);

						expect(await readFile(join(directory, "config.txt"), "utf-8")).toBe(
							userContent,
						);

						const rebased = await readJson(join(directory, ".forge/lock.json"));
						expect(rebased).toMatchObject({
							artifacts: {
								[artifactId]: {
									base: {
										hash: await hashContent(forgeContent),
										mergeKind: "opaque",
										semanticsVersion: 1,
									},
								},
							},
						});

						expect(
							await readFile(
								join(
									directory,
									".forge/bases",
									await hashContent(forgeContent),
								),
								"utf-8",
							),
						).toBe(forgeContent);

						await Effect.runPromise(
							Apply.applyPlan(directory, plan, {
								resolutionPolicy: "accept-forge",
							}).pipe(Effect.provide(coreLayer)),
						);

						expect(await readFile(join(directory, "config.txt"), "utf-8")).toBe(
							forgeContent,
						);

						await Effect.runPromise(
							Apply.applyPlan(directory, plan).pipe(Effect.provide(coreLayer)),
						);

						expect(await readFile(join(directory, "config.txt"), "utf-8")).toBe(
							forgeContent,
						);
					}
				},
			);
		};

		await resolve("keep-user");
		await resolve("accept-forge");
	});

	it("makes keep-user durable for base-less surfaces", async () => {
		await withTempDir(
			"apply-base-less-surface-resolution",
			async (directory) => {
				const artifactId = "module:web:surface:page";
				const path = "apps/web/app/page.tsx";
				const render = "export default function Page() {}\n";
				const changedRender =
					"export default function Page() { return null; }\n";

				const acceptedRender =
					"export default function Page() { return <main />; }\n";

				const userContent = `${render}// my page tweak\n`;
				const obsoleteBase = "obsolete render\n";
				const obsoleteHash = await hashContent(obsoleteBase);
				const renderHash = await hashContent(render);
				const planFor = async (content: string): Promise<ApplyPlan> => ({
					lockfile: {
						artifacts: {
							[artifactId]: {
								definitionIds: ["nextjs/base"],
								hash: await hashContent(content),
								kind: "surface",
								path,
							},
						},
					},
					manifest: { config: {}, installs: [], modules: {} },
					removals: [],
					writes: [{ artifactId, content, path }],
				});

				await writeText(join(directory, path), userContent);
				await Effect.runPromise(
					Effect.gen(function* () {
						yield* State.writeBase(directory, obsoleteHash, obsoleteBase);
						yield* State.writeLockfile(directory, {
							artifacts: {
								[artifactId]: {
									definitionIds: ["nextjs/base"],
									hash: renderHash,
									kind: "surface",
									path,
								},
							},
						});
					}).pipe(Effect.provide(coreLayer)),
				);

				const plan = await planFor(render);
				await Effect.runPromise(
					Apply.applyPlan(directory, plan, {
						resolutionPolicy: "keep-user",
					}).pipe(Effect.provide(coreLayer)),
				);

				expect(await readFile(join(directory, path), "utf-8")).toBe(
					userContent,
				);

				expect(
					await readJson<Lockfile>(join(directory, ".forge/lock.json")),
				).toMatchObject({
					artifacts: {
						[artifactId]: {
							base: {
								hash: renderHash,
								mergeKind: "opaque",
								semanticsVersion: 1,
							},
							hash: await hashContent(userContent),
							kind: "surface",
						},
					},
				});

				expect(
					await readFile(join(directory, ".forge/bases", renderHash), "utf-8"),
				).toBe(render);

				expect(
					await pathExists(join(directory, ".forge/bases", obsoleteHash)),
				).toBe(false);

				await Effect.runPromise(
					Apply.applyPlan(directory, plan).pipe(Effect.provide(coreLayer)),
				);

				expect(await readFile(join(directory, path), "utf-8")).toBe(
					userContent,
				);

				expect(
					await pathExists(join(directory, ".forge/bases", renderHash)),
				).toBe(true);

				const changedPlan = await planFor(changedRender);
				const lockBeforeRefusal = await readFile(
					join(directory, ".forge/lock.json"),
					"utf-8",
				);

				const error = await Effect.runPromise(
					Effect.flip(
						Apply.applyPlan(directory, changedPlan).pipe(
							Effect.provide(coreLayer),
						),
					),
				);

				expect(error).toMatchObject({ message: "Managed File Modified", path });
				expect(await readFile(join(directory, path), "utf-8")).toBe(
					userContent,
				);

				expect(
					await readFile(join(directory, ".forge/lock.json"), "utf-8"),
				).toBe(lockBeforeRefusal);

				await Effect.runPromise(
					Apply.applyPlan(directory, changedPlan, {
						resolutionPolicy: "keep-user",
					}).pipe(Effect.provide(coreLayer)),
				);

				const changedHash = await hashContent(changedRender);
				expect(await readFile(join(directory, path), "utf-8")).toBe(
					userContent,
				);

				expect(
					await readFile(join(directory, ".forge/bases", changedHash), "utf-8"),
				).toBe(changedRender);

				expect(
					await pathExists(join(directory, ".forge/bases", renderHash)),
				).toBe(false);

				await Effect.runPromise(
					Apply.applyPlan(directory, await planFor(acceptedRender), {
						resolutionPolicy: "accept-forge",
					}).pipe(Effect.provide(coreLayer)),
				);

				expect(await readFile(join(directory, path), "utf-8")).toBe(
					acceptedRender,
				);
			},
		);
	});

	it("refuses keep-user rebases without an artifact id", async () => {
		await withTempDir(
			"apply-keep-user-missing-artifact-id",
			async (directory) => {
				const path = "managed.txt";
				const managed = "managed\n";
				const user = "user\n";
				await writeText(join(directory, path), user);
				await Effect.runPromise(
					State.writeLockfile(directory, {
						artifacts: {
							artifact: {
								definitionIds: ["fixture"],
								hash: await hashContent(managed),
								kind: "file",
								path,
							},
						},
					}).pipe(Effect.provide(coreLayer)),
				);

				const error = await Effect.runPromise(
					Effect.flip(
						Apply.applyPlan(
							directory,
							{
								lockfile: { artifacts: {} },
								manifest: { config: {}, installs: [], modules: {} },
								removals: [],
								writes: [{ content: "incoming\n", path }],
							},
							{ resolutionPolicy: "keep-user" },
						).pipe(Effect.provide(coreLayer)),
					),
				);

				expect(error).toMatchObject({ message: "Managed File Modified", path });
				expect(await readFile(join(directory, path), "utf-8")).toBe(user);
			},
		);
	});

	it("resolves JSONC parse refusals according to policy", async () => {
		const resolve = async (policy: "accept-forge" | "keep-user") => {
			await withTempDir(
				`apply-jsonc-resolution-${policy}`,
				async (directory) => {
					const artifactId = "project:surface:turboConfig";
					const base = '{\n\t"tasks": {}\n}\n';
					const baseHash = await hashContent(base);

					const user = '{\n\t// user comment\n\t"tasks": {}\n}\n';
					const incoming = '{\n\t"tasks": { "build": {} }\n}\n';
					const incomingHash = await hashContent(incoming);
					await writeText(join(directory, "turbo.json"), user);
					await Effect.runPromise(
						Effect.gen(function* () {
							yield* State.writeBase(directory, baseHash, base);
							yield* State.writeLockfile(directory, {
								artifacts: {
									[artifactId]: {
										base: {
											hash: baseHash,
											mergeKind: "json",
											semanticsVersion: 1,
										},
										definitionIds: ["turbo"],
										hash: baseHash,
										kind: "surface",
										path: "turbo.json",
									},
								},
							});
						}).pipe(Effect.provide(coreLayer)),
					);

					await Effect.runPromise(
						Apply.applyPlan(
							directory,
							{
								lockfile: {
									artifacts: {
										[artifactId]: {
											base: {
												hash: incomingHash,
												mergeKind: "json",
												semanticsVersion: 1,
											},
											definitionIds: ["turbo"],
											hash: incomingHash,
											kind: "surface",
											path: "turbo.json",
										},
									},
								},
								manifest: { config: {}, installs: [], modules: {} },
								removals: [],
								writes: [{ artifactId, content: incoming, path: "turbo.json" }],
							},
							{ resolutionPolicy: policy },
						).pipe(Effect.provide(coreLayer)),
					);

					const expected = policy === "keep-user" ? user : incoming;
					expect(await readFile(join(directory, "turbo.json"), "utf-8")).toBe(
						expected,
					);

					expect(
						await readJson(join(directory, ".forge/lock.json")),
					).toMatchObject({
						artifacts: { [artifactId]: { hash: await hashContent(expected) } },
					});

					if (policy === "keep-user") {
						await Effect.runPromise(
							Apply.applyPlan(directory, {
								lockfile: {
									artifacts: {
										[artifactId]: {
											base: {
												hash: incomingHash,
												mergeKind: "json",
												semanticsVersion: 1,
											},
											definitionIds: ["turbo"],
											hash: incomingHash,
											kind: "surface",
											path: "turbo.json",
										},
									},
								},
								manifest: { config: {}, installs: [], modules: {} },
								removals: [],
								writes: [{ artifactId, content: incoming, path: "turbo.json" }],
							}).pipe(Effect.provide(coreLayer)),
						);

						expect(await readFile(join(directory, "turbo.json"), "utf-8")).toBe(
							user,
						);
					}
				},
			);
		};

		await resolve("keep-user");
		await resolve("accept-forge");
	});

	it("refuses to remove a modified managed file", async () => {
		await withTempDir("apply-remove", async (directory) => {
			await writeText(`${directory}/packages/ui/forge.json`, "{\n}\n");

			const previousLockfile: Lockfile = {
				schemaVersion: 1,
				artifacts: {
					"project:file:packages/ui/forge.json": {
						definitionIds: ["ui"],
						hash: await hashContent('{\n\t"old": true\n}\n'),
						kind: "file",
						path: "packages/ui/forge.json",
					},
				},
			};

			await Effect.runPromise(
				State.writeLockfile(directory, previousLockfile).pipe(
					Effect.provide(coreLayer),
				),
			);

			const error = await Effect.runPromise(
				Effect.flip(
					Apply.applyPlan(directory, {
						lockfile: { artifacts: {} },
						manifest: { config: {}, installs: [], modules: {} },
						removals: ["packages/ui/forge.json"],
						writes: [],
					}).pipe(Effect.provide(coreLayer)),
				),
			);

			expect(error).toMatchObject({
				_tag: "ApplyError",
				message: "Managed File Modified",
				path: "packages/ui/forge.json",
				preflight: { hasManagedRemovals: true },
			});

			if (!(error instanceof ApplyError))
				throw new Error("Expected ApplyError");

			expect(formatApplyError(error)).toBe(
				"Forge cannot safely update these files:\npackages/ui/forge.json was modified after Forge last managed it.\nRun again with --accept-forge to let Forge delete it.",
			);

			expect(
				await readFile(`${directory}/packages/ui/forge.json`, "utf-8"),
			).toBe("{\n}\n");

			expect(await readJson(join(directory, ".forge/lock.json"))).toEqual(
				previousLockfile,
			);

			expect(await pathExists(join(directory, ".forge/manifest.json"))).toBe(
				false,
			);
		});
	});

	it("requires accept-forge to remove an unchanged adopted artifact", async () => {
		await withTempDir("apply-remove-adopted", async (directory) => {
			const path = "commitlint.config.ts";
			const content = "export default { rules: {} };\n";
			const hash = await hashContent(content);
			await writeText(join(directory, path), content);
			await Effect.runPromise(
				Effect.gen(function* () {
					yield* State.writeBase(directory, hash, content);
					yield* State.writeLockfile(directory, {
						artifacts: {
							commitlint: {
								base: {
									hash,
									mergeKind: "opaque",
									origin: "adopted",
									semanticsVersion: 1,
								},
								definitionIds: ["commitlint"],
								hash,
								kind: "file",
								path,
							},
						},
					});
				}).pipe(Effect.provide(coreLayer)),
			);

			const resolutionPolicies: ReadonlyArray<"refuse" | "keep-user"> = [
				"refuse",
				"keep-user",
			];

			for (const resolutionPolicy of resolutionPolicies) {
				const error = await Effect.runPromise(
					Effect.flip(
						Apply.applyPlan(
							directory,
							{
								lockfile: { artifacts: {} },
								manifest: { config: {}, installs: [], modules: {} },
								removals: [path],
								writes: [],
							},
							{ resolutionPolicy },
						).pipe(Effect.provide(coreLayer)),
					),
				);

				expect(error).toMatchObject({
					message: "Managed File Modified",
					path,
					preflight: { hasManagedRemovals: true },
				});

				if (!(error instanceof ApplyError))
					throw new Error("Expected ApplyError");

				expect(formatApplyError(error)).toContain(
					"Run again with --accept-forge to let Forge delete it.",
				);

				expect(formatApplyError(error)).not.toContain("--keep-user");
				expect(await readFile(join(directory, path), "utf-8")).toBe(content);
			}

			await Effect.runPromise(
				Apply.applyPlan(
					directory,
					{
						lockfile: { artifacts: {} },
						manifest: { config: {}, installs: [], modules: {} },
						removals: [path],
						writes: [],
					},
					{ resolutionPolicy: "accept-forge" },
				).pipe(Effect.provide(coreLayer)),
			);

			expect(await pathExists(join(directory, path))).toBe(false);
		});
	});

	it("refuses keep-user removal of a modified opaque artifact", async () => {
		await withTempDir("apply-keep-user-remove", async (directory) => {
			const path = "opaque.txt";
			await writeText(join(directory, path), "user\n");
			const previous: Lockfile = {
				schemaVersion: 1,
				artifacts: {
					opaque: {
						definitionIds: ["fixture"],
						hash: await hashContent("managed\n"),
						kind: "file",
						path,
					},
				},
			};

			await Effect.runPromise(
				State.writeLockfile(directory, previous).pipe(
					Effect.provide(coreLayer),
				),
			);

			const error = await Effect.runPromise(
				Effect.flip(
					Apply.applyPlan(
						directory,
						{
							lockfile: { artifacts: {} },
							manifest: { config: {}, installs: [], modules: {} },
							removals: [path],
							writes: [],
						},
						{ resolutionPolicy: "keep-user" },
					).pipe(Effect.provide(coreLayer)),
				),
			);

			expect(error).toMatchObject({ message: "Managed File Modified", path });
			expect(await readFile(join(directory, path), "utf-8")).toBe("user\n");
			expect(await readJson(join(directory, ".forge/lock.json"))).toEqual(
				previous,
			);
		});
	});

	it("refuses removal when the stored descriptor is incompatible", async () => {
		await withTempDir("apply-incompatible-remove", async (directory) => {
			const path = "surface.txt";
			const content = "user\n";
			await writeText(join(directory, path), content);
			await Effect.runPromise(
				State.writeLockfile(directory, {
					artifacts: {
						artifact: {
							base: {
								hash: await hashContent("managed\n"),
								mergeKind: "json",
								semanticsVersion: 1,
							},
							definitionIds: ["fixture"],
							hash: await hashContent("managed\n"),
							kind: "file",
							path,
						},
					},
				}).pipe(Effect.provide(coreLayer)),
			);

			const error = await Effect.runPromise(
				Effect.flip(
					Apply.applyPlan(
						directory,
						{
							lockfile: { artifacts: {} },
							manifest: { config: {}, installs: [], modules: {} },
							removals: [path],
							writes: [],
						},
						{ resolutionPolicy: "accept-forge" },
					).pipe(Effect.provide(coreLayer)),
				),
			);

			expect(error).toMatchObject({ message: "Managed File Modified", path });
			expect(await readFile(join(directory, path), "utf-8")).toBe(content);
		});
	});

	it("refuses to overwrite an unmanaged file", async () => {
		await withTempDir("apply-unmanaged-write", async (directory) => {
			await writeText(
				join(directory, "apps/web/app/layout.tsx"),
				"user-owned\n",
			);

			const error = await Effect.runPromise(
				Effect.flip(
					Apply.applyPlan(directory, {
						lockfile: { artifacts: {} },
						manifest: { config: {}, installs: [], modules: {} },
						removals: [],
						writes: [
							{
								content: "generated\n",
								path: "apps/web/app/layout.tsx",
							},
						],
					}).pipe(Effect.provide(coreLayer)),
				),
			);

			expect(error).toMatchObject({
				_tag: "ApplyError",
				message: "Unmanaged File Exists",
				path: "apps/web/app/layout.tsx",
			});

			expect(
				await readFile(join(directory, "apps/web/app/layout.tsx"), "utf-8"),
			).toBe("user-owned\n");
		});
	});

	it("keeps or overwrites an unmanaged file with either resolution policy", async () => {
		const plan: ApplyPlan = {
			lockfile: {
				artifacts: {
					"project:file:config.txt": {
						definitionIds: ["test"],
						hash: await hashContent("forge\n"),
						kind: "file",
						path: "config.txt",
					},
				},
			},
			manifest: { config: {}, installs: [], modules: {} },
			removals: [],
			writes: [
				{
					artifactId: "project:file:config.txt",
					content: "forge\n",
					path: "config.txt",
				},
			],
		};

		await withTempDir("apply-unmanaged-keep-user", async (directory) => {
			await writeText(join(directory, "config.txt"), "user\n");
			await Effect.runPromise(
				Apply.applyPlan(directory, plan, {
					resolutionPolicy: "keep-user",
				}).pipe(Effect.provide(coreLayer)),
			);

			expect(await readFile(join(directory, "config.txt"), "utf-8")).toBe(
				"user\n",
			);

			expect(await readJson(join(directory, ".forge/lock.json"))).toMatchObject(
				{
					artifacts: {
						"project:file:config.txt": {
							base: { origin: "adopted" },
							hash: await hashContent("user\n"),
						},
					},
				},
			);
		});

		await withTempDir(
			"apply-unmanaged-keep-user-identical",
			async (directory) => {
				await writeText(join(directory, "config.txt"), "forge\n");
				await Effect.runPromise(
					Apply.applyPlan(directory, plan, {
						resolutionPolicy: "keep-user",
					}).pipe(Effect.provide(coreLayer)),
				);

				expect(await readJson(join(directory, ".forge/lock.json"))).toEqual({
					...plan.lockfile,
					schemaVersion: 1,
				});
			},
		);

		await withTempDir("apply-unmanaged-accept-forge", async (directory) => {
			await writeText(join(directory, "config.txt"), "user\n");
			await Effect.runPromise(
				Apply.applyPlan(directory, plan, {
					resolutionPolicy: "accept-forge",
				}).pipe(Effect.provide(coreLayer)),
			);

			expect(await readFile(join(directory, "config.txt"), "utf-8")).toBe(
				"forge\n",
			);

			expect(await readJson(join(directory, ".forge/lock.json"))).toEqual({
				...plan.lockfile,
				schemaVersion: 1,
			});
		});
	});

	it("resolves managed conflicts and adopts unmanaged files in one keep-user run", async () => {
		await withTempDir("apply-resolution-abort", async (directory) => {
			const base = '{\n\t"scripts": { "dev": "vite" }\n}\n';
			const baseHash = await hashContent(base);
			const artifactId = "project:surface:rootPackageJson";
			const artifact: LockfileArtifact = {
				base: { hash: baseHash, mergeKind: "json", semanticsVersion: 1 },
				definitionIds: ["root"],
				hash: baseHash,
				kind: "surface",
				path: "package.json",
			};

			await Effect.runPromise(
				Apply.applyPlan(directory, {
					lockfile: { artifacts: { [artifactId]: artifact } },
					manifest: { config: {}, installs: [], modules: {} },
					removals: [],
					writes: [{ artifactId, content: base, path: "package.json" }],
				}).pipe(Effect.provide(coreLayer)),
			);

			const userPackage = '{\n\t"scripts": { "dev": "vite --host" }\n}\n';
			await writeText(join(directory, "package.json"), userPackage);
			await writeText(join(directory, "config.txt"), "user\n");
			const incoming = '{\n\t"scripts": { "dev": "vite --port 4000" }\n}\n';
			const incomingHash = await hashContent(incoming);

			await Effect.runPromise(
				Apply.applyPlan(
					directory,
					{
						lockfile: {
							artifacts: {
								[artifactId]: {
									...artifact,
									base: {
										hash: incomingHash,
										mergeKind: "json",
										semanticsVersion: 1,
									},
									hash: incomingHash,
								},
								"project:file:config.txt": {
									definitionIds: ["test"],
									hash: await hashContent("forge\n"),
									kind: "file",
									path: "config.txt",
								},
							},
						},
						manifest: {
							config: { changed: true },
							installs: [],
							modules: {},
						},
						removals: [],
						writes: [
							{ artifactId, content: incoming, path: "package.json" },
							{
								artifactId: "project:file:config.txt",
								content: "forge\n",
								path: "config.txt",
							},
						],
					},
					{ resolutionPolicy: "keep-user" },
				).pipe(Effect.provide(coreLayer)),
			);

			expect(await readJson(join(directory, "package.json"))).toEqual(
				JSON.parse(userPackage),
			);

			expect(await readFile(join(directory, "config.txt"), "utf-8")).toBe(
				"user\n",
			);

			expect(await readJson(join(directory, ".forge/lock.json"))).toMatchObject(
				{
					artifacts: {
						"project:file:config.txt": { base: { origin: "adopted" } },
					},
				},
			);
		});
	});

	it("refuses to remove an unmanaged file", async () => {
		await withTempDir("apply-unmanaged-remove", async (directory) => {
			await writeText(join(directory, "packages/ui/notes.txt"), "keep me\n");

			const error = await Effect.runPromise(
				Effect.flip(
					Apply.applyPlan(directory, {
						lockfile: { artifacts: {} },
						manifest: { config: {}, installs: [], modules: {} },
						removals: ["packages/ui/notes.txt"],
						writes: [],
					}).pipe(Effect.provide(coreLayer)),
				),
			);

			expect(error).toMatchObject({
				_tag: "ApplyError",
				message: "Unmanaged File Exists",
				path: "packages/ui/notes.txt",
			});

			expect(
				await readFile(join(directory, "packages/ui/notes.txt"), "utf-8"),
			).toBe("keep me\n");

			if (!(error instanceof ApplyError))
				throw new Error("Expected ApplyError");

			expect(formatApplyError(error)).toBe(
				"Forge cannot safely update these files:\npackages/ui/notes.txt already exists and is not managed by Forge.\nRun again with --keep-user to keep it, or --accept-forge to let Forge delete it.",
			);
		});
	});

	it("accepts explicit removal of unmanaged and modified files", async () => {
		await withTempDir("apply-accept-removals", async (directory) => {
			const base = '{\n\t"tasks": {}\n}\n';
			const baseHash = await hashContent(base);
			const oldOpaqueHash = await hashContent("old\n");
			await writeText(join(directory, "unmanaged.txt"), "user\n");
			await writeText(join(directory, "opaque.txt"), "user\n");
			await writeText(
				join(directory, "turbo.json"),
				'{\n\t// user comment\n\t"tasks": {}\n}\n',
			);

			await Effect.runPromise(
				Effect.gen(function* () {
					yield* State.writeBase(directory, baseHash, base);
					yield* State.writeLockfile(directory, {
						artifacts: {
							"project:file:opaque": {
								definitionIds: ["test"],
								hash: oldOpaqueHash,
								kind: "file",
								path: "opaque.txt",
							},
							"project:surface:turboConfig": {
								base: {
									hash: baseHash,
									mergeKind: "json",
									semanticsVersion: 1,
								},
								definitionIds: ["turbo"],
								hash: baseHash,
								kind: "surface",
								path: "turbo.json",
							},
						},
					});
				}).pipe(Effect.provide(coreLayer)),
			);

			await Effect.runPromise(
				Apply.applyPlan(
					directory,
					{
						lockfile: { artifacts: {} },
						manifest: { config: {}, installs: [], modules: {} },
						removals: ["unmanaged.txt", "opaque.txt", "turbo.json"],
						writes: [],
					},
					{ resolutionPolicy: "accept-forge" },
				).pipe(Effect.provide(coreLayer)),
			);

			expect(await pathExists(join(directory, "unmanaged.txt"))).toBe(false);
			expect(await pathExists(join(directory, "opaque.txt"))).toBe(false);
			expect(await pathExists(join(directory, "turbo.json"))).toBe(false);
		});
	});

	it("re-applies an identical plan without touching matching files", async () => {
		await withTempDir("apply-idempotent", async (directory) => {
			const plan = {
				lockfile: { artifacts: {}, schemaVersion: 1 },
				manifest: { config: {}, installs: [], modules: {}, schemaVersion: 1 },
				removals: [],
				writes: [{ content: "export {};\n", path: "packages/db/src/index.ts" }],
			};

			await Effect.runPromise(
				Apply.applyPlan(directory, plan).pipe(Effect.provide(coreLayer)),
			);

			expect(
				await readFile(join(directory, "packages/db/src/index.ts"), "utf-8"),
			).toBe("export {};\n");

			expect(await readJson(join(directory, ".forge/manifest.json"))).toEqual({
				...plan.manifest,
				cliVersion: "test-cli-version",
			});

			expect(await readJson(join(directory, ".forge/lock.json"))).toEqual(
				plan.lockfile,
			);

			await Effect.runPromise(
				Apply.applyPlan(directory, plan).pipe(Effect.provide(coreLayer)),
			);

			expect(
				await readFile(join(directory, "packages/db/src/index.ts"), "utf-8"),
			).toBe("export {};\n");
		});
	});

	it("accepts a moved artifact whose content matches its lockfile hash", async () => {
		await withTempDir("apply-move", async (directory) => {
			const movedContent = "export const db = {};\n";

			await writeText(join(directory, "new/path.ts"), movedContent);

			await Effect.runPromise(
				State.writeLockfile(directory, {
					artifacts: {
						"project:file:old/path.ts": {
							definitionIds: ["drizzle"],
							hash: await hashContent(movedContent),
							kind: "file",
							path: "old/path.ts",
						},
					},
				}).pipe(Effect.provide(coreLayer)),
			);

			await Effect.runPromise(
				Apply.applyPlan(directory, {
					lockfile: { artifacts: {} },
					manifest: { config: {}, installs: [], modules: {} },
					removals: [],
					writes: [
						{
							artifactId: "project:file:old/path.ts",
							content: "export const db = { fresh: true };\n",
							path: "new/path.ts",
						},
					],
				}).pipe(Effect.provide(coreLayer)),
			);

			expect(await readFile(join(directory, "new/path.ts"), "utf-8")).toBe(
				"export const db = { fresh: true };\n",
			);
		});
	});

	it("refuses to overwrite a modified moved artifact", async () => {
		await withTempDir("apply-move-modified", async (directory) => {
			await writeText(join(directory, "new/path.ts"), "user-tweak\n");

			await Effect.runPromise(
				State.writeLockfile(directory, {
					artifacts: {
						"project:file:old/path.ts": {
							definitionIds: ["drizzle"],
							hash: await hashContent("export const db = {};\n"),
							kind: "file",
							path: "old/path.ts",
						},
					},
				}).pipe(Effect.provide(coreLayer)),
			);

			const error = await Effect.runPromise(
				Effect.flip(
					Apply.applyPlan(directory, {
						lockfile: { artifacts: {} },
						manifest: { config: {}, installs: [], modules: {} },
						removals: [],
						writes: [
							{
								artifactId: "project:file:old/path.ts",
								content: "export const db = { fresh: true };\n",
								path: "new/path.ts",
							},
						],
					}).pipe(Effect.provide(coreLayer)),
				),
			);

			expect(error).toMatchObject({
				_tag: "ApplyError",
				message: "Managed File Modified",
				path: "new/path.ts",
			});

			expect(await readFile(join(directory, "new/path.ts"), "utf-8")).toBe(
				"user-tweak\n",
			);
		});
	});

	it("always rewrites forge.json artifacts even when hand-edited", async () => {
		await withTempDir("apply-forge-json", async (directory) => {
			await writeText(
				join(directory, "apps/web/forge.json"),
				'{\n\t"id": "abcde",\n\t"edited": true\n}\n',
			);

			await Effect.runPromise(
				State.writeLockfile(directory, {
					artifacts: {
						"module:abcde:file:forge.json": {
							definitionIds: ["nextjs/base"],
							hash: await hashContent('{\n\t"id": "abcde"\n}\n'),
							kind: "file",
							path: "apps/web/forge.json",
						},
					},
				}).pipe(Effect.provide(coreLayer)),
			);

			await Effect.runPromise(
				Apply.applyPlan(directory, {
					lockfile: { artifacts: {} },
					manifest: { config: {}, installs: [], modules: {} },
					removals: [],
					writes: [
						{
							artifactId: "module:abcde:file:forge.json",
							content: '{\n\t"id": "abcde",\n\t"slots": {}\n}\n',
							path: "apps/web/forge.json",
						},
					],
				}).pipe(Effect.provide(coreLayer)),
			);

			expect(
				await readFile(join(directory, "apps/web/forge.json"), "utf-8"),
			).toBe('{\n\t"id": "abcde",\n\t"slots": {}\n}\n');
		});
	});

	it("adopts an identical unmanaged module marker", async () => {
		await withTempDir("apply-adopt-marker", async (directory) => {
			const path = "apps/web/forge.json";
			const content = '{\n\t"id": "abcde",\n\t"slots": {}\n}\n';
			const hash = await hashContent(content);
			await writeText(join(directory, path), content);
			const nodeLayer = NodeServices.layer;
			const fileSystemLayer = Layer.effect(
				FileSystem.FileSystem,
				Effect.map(FileSystem.FileSystem, (fileSystem) => ({
					...fileSystem,
					rename: (oldPath, newPath) =>
						newPath.endsWith(`/${path}`)
							? Effect.fail(
									PlatformError.systemError({
										method: "rename",
										module: "FileSystem",
										pathOrDescriptor: newPath,
										_tag: "PermissionDenied",
									}),
								)
							: fileSystem.rename(oldPath, newPath),
				})),
			).pipe(Layer.provide(nodeLayer));

			const noMarkerWriteLayer = Layer.mergeAll(
				Apply.Default.pipe(
					Layer.provide(
						Layer.succeed(CliVersion, { version: "test-cli-version" }),
					),
				),
				State.Default.pipe(
					Layer.provide(
						Layer.succeed(CliVersion, { version: "test-cli-version" }),
					),
				),
			).pipe(Layer.provide(fileSystemLayer));

			await Effect.runPromise(
				Apply.applyPlan(directory, {
					lockfile: {
						artifacts: {
							"module:abcde:file:forge.json": {
								definitionIds: ["nextjs/base"],
								hash,
								kind: "file",
								path,
							},
						},
					},
					manifest: { config: {}, installs: [], modules: {} },
					removals: [],
					writes: [
						{
							artifactId: "module:abcde:file:forge.json",
							content,
							path,
						},
					],
				}).pipe(Effect.provide(noMarkerWriteLayer)),
			);

			expect(await readFile(join(directory, path), "utf-8")).toBe(content);
			expect(
				await readJson<Lockfile>(join(directory, ".forge/lock.json")),
			).toMatchObject({
				artifacts: { "module:abcde:file:forge.json": { hash } },
			});
		});
	});

	it("refuses a differing unmanaged module marker", async () => {
		await withTempDir("apply-refuse-marker", async (directory) => {
			const path = "apps/web/forge.json";
			const userContent = '{\n\t"user": true\n}\n';
			const forgeContent = '{\n\t"id": "abcde",\n\t"slots": {}\n}\n';
			await writeText(join(directory, path), userContent);

			const error = await Effect.runPromise(
				Effect.flip(
					Apply.applyPlan(directory, {
						lockfile: {
							artifacts: {
								"module:abcde:file:forge.json": {
									definitionIds: ["nextjs/base"],
									hash: await hashContent(forgeContent),
									kind: "file",
									path,
								},
							},
						},
						manifest: { config: {}, installs: [], modules: {} },
						removals: [],
						writes: [
							{
								artifactId: "module:abcde:file:forge.json",
								content: forgeContent,
								path,
							},
						],
					}).pipe(Effect.provide(coreLayer)),
				),
			);

			expect(error).toMatchObject({
				message: "Unmanaged File Exists",
				path,
			});

			expect(await readFile(join(directory, path), "utf-8")).toBe(userContent);
		});
	});

	it("protects hand-edited project forge.json artifacts", async () => {
		await withTempDir("apply-project-forge-json", async (directory) => {
			const managedContent = '{\n\t"managed": true\n}\n';
			const userContent = '{\n\t"edited": true\n}\n';
			const nextContent = '{\n\t"next": true\n}\n';

			await writeText(join(directory, "forge.json"), userContent);
			await Effect.runPromise(
				State.writeLockfile(directory, {
					artifacts: {
						"project:file:forge.json": {
							definitionIds: ["test"],
							hash: await hashContent(managedContent),
							kind: "file",
							path: "forge.json",
						},
					},
				}).pipe(Effect.provide(coreLayer)),
			);

			const error = await Effect.runPromise(
				Effect.flip(
					Apply.applyPlan(directory, {
						lockfile: { artifacts: {} },
						manifest: { config: {}, installs: [], modules: {} },
						removals: [],
						writes: [
							{
								artifactId: "project:file:forge.json",
								content: nextContent,
								path: "forge.json",
							},
						],
					}).pipe(Effect.provide(coreLayer)),
				),
			);

			expect(error).toMatchObject({
				_tag: "ApplyError",
				message: "Managed File Modified",
				path: "forge.json",
			});

			expect(await readFile(join(directory, "forge.json"), "utf-8")).toBe(
				userContent,
			);
		});
	});

	it("prunes emptied directories after removals and stops at non-empty ancestors", async () => {
		await withTempDir("apply-prune", async (directory) => {
			const removedFile = "packages/db/src/schema/index.ts";
			const siblingFile = "packages/trpc/src/index.ts";
			const content = "export {};\n";

			await writeText(join(directory, removedFile), content);
			await writeText(join(directory, siblingFile), content);

			await Effect.runPromise(
				State.writeLockfile(directory, {
					artifacts: {
						[`project:file:${removedFile}`]: {
							definitionIds: ["drizzle"],
							hash: await hashContent(content),
							kind: "file",
							path: removedFile,
						},
					},
				}).pipe(Effect.provide(coreLayer)),
			);

			await Effect.runPromise(
				Apply.applyPlan(directory, {
					lockfile: { artifacts: {} },
					manifest: { config: {}, installs: [], modules: {} },
					removals: [removedFile],
					writes: [],
				}).pipe(Effect.provide(coreLayer)),
			);

			expect(await pathExists(join(directory, "packages/db"))).toBe(false);
			expect(await pathExists(join(directory, siblingFile))).toBe(true);
			expect(await pathExists(join(directory, "packages"))).toBe(true);
		});
	});

	it("keeps directories that still contain unmanaged files", async () => {
		await withTempDir("apply-prune-keep", async (directory) => {
			const removedFile = "packages/db/src/index.ts";
			const content = "export {};\n";

			await writeText(join(directory, removedFile), content);
			await writeText(join(directory, "packages/db/notes.txt"), "keep me\n");

			await Effect.runPromise(
				State.writeLockfile(directory, {
					artifacts: {
						[`project:file:${removedFile}`]: {
							definitionIds: ["drizzle"],
							hash: await hashContent(content),
							kind: "file",
							path: removedFile,
						},
					},
				}).pipe(Effect.provide(coreLayer)),
			);

			await Effect.runPromise(
				Apply.applyPlan(directory, {
					lockfile: { artifacts: {} },
					manifest: { config: {}, installs: [], modules: {} },
					removals: [removedFile],
					writes: [],
				}).pipe(Effect.provide(coreLayer)),
			);

			expect(await pathExists(join(directory, "packages/db/src"))).toBe(false);
			expect(
				await readFile(join(directory, "packages/db/notes.txt"), "utf-8"),
			).toBe("keep me\n");
		});
	});

	it("refuses to remove a file that resolves outside the project root", async () => {
		await withTempDir("apply-prune-escape", async (scratch) => {
			const projectRoot = join(scratch, "project");
			const outside = join(scratch, "outside");
			const removedFile = "packages/link/sub/index.ts";
			const content = "export {};\n";

			await mkdir(join(outside, "sub"), { recursive: true });
			await mkdir(join(projectRoot, "packages"), { recursive: true });
			await symlink(outside, join(projectRoot, "packages/link"));
			await writeText(join(projectRoot, removedFile), content);

			await Effect.runPromise(
				State.writeLockfile(projectRoot, {
					artifacts: {
						[`project:file:${removedFile}`]: {
							definitionIds: ["drizzle"],
							hash: await hashContent(content),
							kind: "file",
							path: removedFile,
						},
					},
				}).pipe(Effect.provide(coreLayer)),
			);

			const error = await Effect.runPromise(
				Effect.flip(
					Apply.applyPlan(projectRoot, {
						lockfile: { artifacts: {} },
						manifest: { config: {}, installs: [], modules: {} },
						removals: [removedFile],
						writes: [],
					}).pipe(Effect.provide(coreLayer)),
				),
			);

			expect(error).toMatchObject({
				_tag: "ApplyError",
				message: "Path Escapes Project Root",
				path: removedFile,
			});

			expect(await pathExists(join(outside, "sub/index.ts"))).toBe(true);
			expect(await pathExists(join(projectRoot, "packages/link"))).toBe(true);
		});
	});

	it("keeps user symlinks instead of unlinking them while pruning", async () => {
		await withTempDir("apply-prune-symlink", async (directory) => {
			const removedFile = "packages/db/index.ts";
			const content = "export {};\n";

			await mkdir(join(directory, "packages/real-db"), { recursive: true });
			await symlink(
				join(directory, "packages/real-db"),
				join(directory, "packages/db"),
			);

			await writeText(join(directory, removedFile), content);

			await Effect.runPromise(
				State.writeLockfile(directory, {
					artifacts: {
						[`project:file:${removedFile}`]: {
							definitionIds: ["drizzle"],
							hash: await hashContent(content),
							kind: "file",
							path: removedFile,
						},
					},
				}).pipe(Effect.provide(coreLayer)),
			);

			await Effect.runPromise(
				Apply.applyPlan(directory, {
					lockfile: { artifacts: {} },
					manifest: { config: {}, installs: [], modules: {} },
					removals: [removedFile],
					writes: [],
				}).pipe(Effect.provide(coreLayer)),
			);

			expect(await pathExists(join(directory, "packages/db"))).toBe(true);
			expect(await pathExists(join(directory, "packages/real-db"))).toBe(true);
		});
	});

	it("does not prune directories for removals that were already gone", async () => {
		await withTempDir("apply-prune-missing", async (directory) => {
			const missingFile = "packages/db/src/index.ts";

			await mkdir(join(directory, "packages/db/src"), { recursive: true });

			await Effect.runPromise(
				State.writeLockfile(directory, {
					artifacts: {
						[`project:file:${missingFile}`]: {
							definitionIds: ["drizzle"],
							hash: await hashContent("export {};\n"),
							kind: "file",
							path: missingFile,
						},
					},
				}).pipe(Effect.provide(coreLayer)),
			);

			await Effect.runPromise(
				Apply.applyPlan(directory, {
					lockfile: { artifacts: {} },
					manifest: { config: {}, installs: [], modules: {} },
					removals: [missingFile],
					writes: [],
				}).pipe(Effect.provide(coreLayer)),
			);

			expect(await pathExists(join(directory, "packages/db/src"))).toBe(true);
		});
	});

	it("accepts a renamed module's leaf file via the previous manifest root", async () => {
		await withTempDir("apply-renamed-leaf", async (directory) => {
			await writeText(
				`${directory}/packages/observability/src/logs.ts`,
				"old-managed\n",
			);

			await Effect.runPromise(
				State.writeManifest(directory, {
					config: {},
					installs: [{ definitionId: "logs", targets: [{ kind: "project" }] }],
					modules: {
						abcde: {
							definitionIds: ["logs"],
							root: "packages/telemetry",
						},
					},
				}).pipe(Effect.provide(coreLayer)),
			);

			await Effect.runPromise(
				State.writeLockfile(directory, {
					artifacts: {
						"module:abcde:file:packages/telemetry/src/logs.ts": {
							definitionIds: ["logs"],
							hash: await hashContent("old-managed\n"),
							kind: "file",
							path: "packages/telemetry/src/logs.ts",
						},
					},
				}).pipe(Effect.provide(coreLayer)),
			);

			await Effect.runPromise(
				Apply.applyPlan(directory, {
					lockfile: { artifacts: {} },
					manifest: {
						config: {},
						installs: [
							{ definitionId: "logs", targets: [{ kind: "project" }] },
						],
						modules: {
							abcde: {
								definitionIds: ["logs"],
								root: "packages/observability",
							},
						},
					},
					removals: [],
					writes: [
						{
							artifactId:
								"module:abcde:file:packages/observability/src/logs.ts",
							content: "new-managed\n",
							path: "packages/observability/src/logs.ts",
						},
					],
				}).pipe(Effect.provide(coreLayer)),
			);

			expect(
				await readFile(
					`${directory}/packages/observability/src/logs.ts`,
					"utf-8",
				),
			).toBe("new-managed\n");
		});
	});

	it("keeps rejecting unmanaged files when the module root is unchanged", async () => {
		await withTempDir("apply-unmanaged-leaf", async (directory) => {
			await writeText(
				`${directory}/packages/telemetry/src/logs.ts`,
				"old-managed\n",
			);

			await Effect.runPromise(
				State.writeManifest(directory, {
					config: {},
					installs: [{ definitionId: "logs", targets: [{ kind: "project" }] }],
					modules: {
						abcde: {
							definitionIds: ["logs"],
							root: "packages/telemetry",
						},
					},
				}).pipe(Effect.provide(coreLayer)),
			);

			await Effect.runPromise(
				State.writeLockfile(directory, { artifacts: {} }).pipe(
					Effect.provide(coreLayer),
				),
			);

			const error = await Effect.runPromise(
				Effect.flip(
					Apply.applyPlan(directory, {
						lockfile: { artifacts: {} },
						manifest: {
							config: {},
							installs: [
								{ definitionId: "logs", targets: [{ kind: "project" }] },
							],
							modules: {
								abcde: {
									definitionIds: ["logs"],
									root: "packages/telemetry",
								},
							},
						},
						removals: [],
						writes: [
							{
								artifactId: "module:abcde:file:packages/telemetry/src/logs.ts",
								content: "new-managed\n",
								path: "packages/telemetry/src/logs.ts",
							},
						],
					}).pipe(Effect.provide(coreLayer)),
				),
			);

			expect(error).toMatchObject({
				_tag: "ApplyError",
				message: "Unmanaged File Exists",
				path: "packages/telemetry/src/logs.ts",
			});
		});
	});

	it("refuses a modified leaf file under a renamed module root", async () => {
		await withTempDir("apply-renamed-modified", async (directory) => {
			await writeText(
				`${directory}/packages/observability/src/logs.ts`,
				"user-tweak\n",
			);

			await Effect.runPromise(
				State.writeManifest(directory, {
					config: {},
					installs: [{ definitionId: "logs", targets: [{ kind: "project" }] }],
					modules: {
						abcde: {
							definitionIds: ["logs"],
							root: "packages/telemetry",
						},
					},
				}).pipe(Effect.provide(coreLayer)),
			);

			await Effect.runPromise(
				State.writeLockfile(directory, {
					artifacts: {
						"module:abcde:file:packages/telemetry/src/logs.ts": {
							definitionIds: ["logs"],
							hash: await hashContent("old-managed\n"),
							kind: "file",
							path: "packages/telemetry/src/logs.ts",
						},
					},
				}).pipe(Effect.provide(coreLayer)),
			);

			const error = await Effect.runPromise(
				Effect.flip(
					Apply.applyPlan(directory, {
						lockfile: { artifacts: {} },
						manifest: {
							config: {},
							installs: [
								{ definitionId: "logs", targets: [{ kind: "project" }] },
							],
							modules: {
								abcde: {
									definitionIds: ["logs"],
									root: "packages/observability",
								},
							},
						},
						removals: [],
						writes: [
							{
								artifactId:
									"module:abcde:file:packages/observability/src/logs.ts",
								content: "new-managed\n",
								path: "packages/observability/src/logs.ts",
							},
						],
					}).pipe(Effect.provide(coreLayer)),
				),
			);

			expect(error).toMatchObject({
				_tag: "ApplyError",
				message: "Managed File Modified",
				path: "packages/observability/src/logs.ts",
			});
		});
	});

	it("does not rescue a leaf file outside the renamed module root", async () => {
		await withTempDir("apply-renamed-outside", async (directory) => {
			await writeText(
				`${directory}/packages/elsewhere/logs.ts`,
				"old-managed\n",
			);

			await Effect.runPromise(
				State.writeManifest(directory, {
					config: {},
					installs: [{ definitionId: "logs", targets: [{ kind: "project" }] }],
					modules: {
						abcde: {
							definitionIds: ["logs"],
							root: "packages/telemetry",
						},
					},
				}).pipe(Effect.provide(coreLayer)),
			);

			await Effect.runPromise(
				State.writeLockfile(directory, {
					artifacts: {
						"module:abcde:file:packages/telemetry/src/logs.ts": {
							definitionIds: ["logs"],
							hash: await hashContent("old-managed\n"),
							kind: "file",
							path: "packages/telemetry/src/logs.ts",
						},
					},
				}).pipe(Effect.provide(coreLayer)),
			);

			const error = await Effect.runPromise(
				Effect.flip(
					Apply.applyPlan(directory, {
						lockfile: { artifacts: {} },
						manifest: {
							config: {},
							installs: [
								{ definitionId: "logs", targets: [{ kind: "project" }] },
							],
							modules: {
								abcde: {
									definitionIds: ["logs"],
									root: "packages/observability",
								},
							},
						},
						removals: [],
						writes: [
							{
								artifactId: "module:abcde:file:packages/elsewhere/logs.ts",
								content: "new-managed\n",
								path: "packages/elsewhere/logs.ts",
							},
						],
					}).pipe(Effect.provide(coreLayer)),
				),
			);

			expect(error).toMatchObject({
				_tag: "ApplyError",
				message: "Unmanaged File Exists",
				path: "packages/elsewhere/logs.ts",
			});
		});
	});

	it("does not rescue when the previous manifest lacks the module", async () => {
		await withTempDir("apply-renamed-no-prev", async (directory) => {
			await writeText(
				`${directory}/packages/observability/src/logs.ts`,
				"old-managed\n",
			);

			await Effect.runPromise(
				State.writeManifest(directory, {
					config: {},
					installs: [{ definitionId: "logs", targets: [{ kind: "project" }] }],
					modules: {},
				}).pipe(Effect.provide(coreLayer)),
			);

			await Effect.runPromise(
				State.writeLockfile(directory, {
					artifacts: {
						"module:abcde:file:packages/telemetry/src/logs.ts": {
							definitionIds: ["logs"],
							hash: await hashContent("old-managed\n"),
							kind: "file",
							path: "packages/telemetry/src/logs.ts",
						},
					},
				}).pipe(Effect.provide(coreLayer)),
			);

			const error = await Effect.runPromise(
				Effect.flip(
					Apply.applyPlan(directory, {
						lockfile: { artifacts: {} },
						manifest: {
							config: {},
							installs: [
								{ definitionId: "logs", targets: [{ kind: "project" }] },
							],
							modules: {
								abcde: {
									definitionIds: ["logs"],
									root: "packages/observability",
								},
							},
						},
						removals: [],
						writes: [
							{
								artifactId:
									"module:abcde:file:packages/observability/src/logs.ts",
								content: "new-managed\n",
								path: "packages/observability/src/logs.ts",
							},
						],
					}).pipe(Effect.provide(coreLayer)),
				),
			);

			expect(error).toMatchObject({
				_tag: "ApplyError",
				message: "Unmanaged File Exists",
				path: "packages/observability/src/logs.ts",
			});
		});
	});

	it("does not rescue when the artifact id disagrees with the write path", async () => {
		await withTempDir("apply-renamed-id-mismatch", async (directory) => {
			await writeText(
				`${directory}/packages/observability/src/logs.ts`,
				"old-managed\n",
			);

			await Effect.runPromise(
				State.writeManifest(directory, {
					config: {},
					installs: [{ definitionId: "logs", targets: [{ kind: "project" }] }],
					modules: {
						abcde: {
							definitionIds: ["logs"],
							root: "packages/telemetry",
						},
					},
				}).pipe(Effect.provide(coreLayer)),
			);

			await Effect.runPromise(
				State.writeLockfile(directory, {
					artifacts: {
						"module:abcde:file:packages/telemetry/src/logs.ts": {
							definitionIds: ["logs"],
							hash: await hashContent("old-managed\n"),
							kind: "file",
							path: "packages/telemetry/src/logs.ts",
						},
					},
				}).pipe(Effect.provide(coreLayer)),
			);

			const error = await Effect.runPromise(
				Effect.flip(
					Apply.applyPlan(directory, {
						lockfile: { artifacts: {} },
						manifest: {
							config: {},
							installs: [
								{ definitionId: "logs", targets: [{ kind: "project" }] },
							],
							modules: {
								abcde: {
									definitionIds: ["logs"],
									root: "packages/observability",
								},
							},
						},
						removals: [],
						writes: [
							{
								artifactId:
									"module:abcde:file:packages/observability/src/other.ts",
								content: "new-managed\n",
								path: "packages/observability/src/logs.ts",
							},
						],
					}).pipe(Effect.provide(coreLayer)),
				),
			);

			expect(error).toMatchObject({
				_tag: "ApplyError",
				message: "Unmanaged File Exists",
				path: "packages/observability/src/logs.ts",
			});
		});
	});

	describe("removed roots", () => {
		const opaque = async (path: string, content: string) => ({
			definitionIds: ["fixture"],
			hash: await hashContent(content),
			kind: "file" as const,
			path,
		});

		async function writeRemovedAppFixture(directory: string) {
			const packageBase = '{\n\t"name": "@acme/admin"\n}\n';
			const packageEdited =
				'{\n\t"name": "@acme/admin",\n\t"private": true\n}\n';

			const adopted = "export const adopted = true;\n";
			const files: Record<string, string> = {
				"apps/admin/forge.json": '{"edited":true}\n',
				"apps/admin/app/layout.tsx": "export const layout = 1;\n",
				"apps/admin/app/page.tsx": "export const page = 1;\n// my edit\n",
				"apps/admin/package.json": packageEdited,
				"apps/admin/adopted.ts": adopted,
				"apps/web/app/page.tsx": "export const web = 1;\n// web edit\n",
			};

			for (const [path, content] of Object.entries(files))
				await writeText(join(directory, path), content);

			const packageHash = await hashContent(packageBase);
			const adoptedHash = await hashContent(adopted);
			const lockfile: Lockfile = {
				schemaVersion: 1,
				artifacts: {
					"module:admin:file:forge.json": await opaque(
						"apps/admin/forge.json",
						"{}\n",
					),
					"module:admin:file:app/layout.tsx": await opaque(
						"apps/admin/app/layout.tsx",
						"export const layout = 1;\n",
					),
					"module:admin:file:app/page.tsx": await opaque(
						"apps/admin/app/page.tsx",
						"export const page = 1;\n",
					),
					"module:admin:surface:packageJson": {
						base: {
							hash: packageHash,
							mergeKind: "json",
							semanticsVersion: 1,
						},
						definitionIds: ["fixture"],
						hash: packageHash,
						kind: "surface",
						path: "apps/admin/package.json",
					},
					"module:admin:file:adopted.ts": {
						base: {
							hash: adoptedHash,
							mergeKind: "opaque",
							origin: "adopted",
							semanticsVersion: 1,
						},
						definitionIds: ["fixture"],
						hash: adoptedHash,
						kind: "file",
						path: "apps/admin/adopted.ts",
					},
					"module:web:file:app/page.tsx": await opaque(
						"apps/web/app/page.tsx",
						"export const web = 1;\n",
					),
				},
			};

			await Effect.runPromise(
				Effect.gen(function* () {
					yield* State.writeBase(directory, packageHash, packageBase);
					yield* State.writeBase(directory, adoptedHash, adopted);
					yield* State.writeLockfile(directory, lockfile);
				}).pipe(Effect.provide(coreLayer)),
			);

			return { files, lockfile };
		}

		const removedAppPaths = [
			"apps/admin/forge.json",
			"apps/admin/app/layout.tsx",
			"apps/admin/app/page.tsx",
			"apps/admin/package.json",
			"apps/admin/adopted.ts",
		];

		const webPage = (content: string) => ({
			artifactId: "module:web:file:app/page.tsx",
			content,
			path: "apps/web/app/page.tsx",
		});

		const removalPlan = async (
			removedRoots?: ReadonlyArray<string>,
		): Promise<ApplyPlan> => ({
			lockfile: {
				artifacts: {
					"module:web:file:app/page.tsx": await opaque(
						"apps/web/app/page.tsx",
						"export const web = 1;\n",
					),
				},
			},
			manifest: { config: {}, installs: [], modules: {} },
			removals: removedAppPaths,
			...(removedRoots === undefined ? {} : { removedRoots }),
			writes: [webPage("export const web = 1;\n")],
		});

		it("keeps edited and adopted files inside a removed root and reports them", async () => {
			await withTempDir("apply-removed-root-retain", async (directory) => {
				const { files } = await writeRemovedAppFixture(directory);
				await writeText(
					join(directory, "apps/web/app/page.tsx"),
					"export const web = 1;\n",
				);

				const result = await Effect.runPromise(
					Apply.applyPlan(directory, await removalPlan(["apps/admin"])).pipe(
						Effect.provide(coreLayer),
					),
				);

				expect(result.retained).toEqual([
					"apps/admin/adopted.ts",
					"apps/admin/app/page.tsx",
					"apps/admin/package.json",
				]);

				for (const path of result.retained)
					expect(await readFile(join(directory, path), "utf-8")).toBe(
						files[path],
					);

				expect(await pathExists(join(directory, "apps/admin/forge.json"))).toBe(
					false,
				);

				expect(
					await pathExists(join(directory, "apps/admin/app/layout.tsx")),
				).toBe(false);

				const lockfile = await readJson<Lockfile>(
					join(directory, ".forge/lock.json"),
				);

				expect(
					Object.values(lockfile.artifacts).map((artifact) => artifact.path),
				).toEqual(["apps/web/app/page.tsx"]);
			});
		});

		it("still refuses edited removals without a removed root", async () => {
			await withTempDir("apply-removed-root-unscoped", async (directory) => {
				const { files, lockfile } = await writeRemovedAppFixture(directory);
				await writeText(
					join(directory, "apps/web/app/page.tsx"),
					"export const web = 1;\n",
				);

				const error = await Effect.runPromise(
					Effect.flip(
						Apply.applyPlan(directory, await removalPlan()).pipe(
							Effect.provide(coreLayer),
						),
					),
				);

				expect(error).toMatchObject({
					_tag: "ApplyError",
					reason: "preflight-failed",
				});

				for (const [path, content] of Object.entries(files))
					if (path !== "apps/web/app/page.tsx")
						expect(await readFile(join(directory, path), "utf-8")).toBe(
							content,
						);

				expect(await readJson(join(directory, ".forge/lock.json"))).toEqual(
					lockfile,
				);
			});
		});

		it("limits accept-forge to the removed root", async () => {
			await withTempDir("apply-removed-root-force", async (directory) => {
				const { files } = await writeRemovedAppFixture(directory);

				const error = await Effect.runPromise(
					Effect.flip(
						Apply.applyPlan(directory, await removalPlan(["apps/admin"]), {
							resolutionPolicy: "accept-forge",
						}).pipe(Effect.provide(coreLayer)),
					),
				);

				expect(error).toMatchObject({
					_tag: "ApplyError",
					path: "apps/web/app/page.tsx",
					reason: "managed-file-modified",
				});

				for (const [path, content] of Object.entries(files))
					expect(await readFile(join(directory, path), "utf-8")).toBe(content);

				const resolved = await Effect.runPromise(
					Apply.applyPlan(directory, await removalPlan(["apps/admin"]), {
						conflictResolutions: {
							"apps/web/app/page.tsx": { resolution: "user" },
						},
						resolutionPolicy: "accept-forge",
					}).pipe(Effect.provide(coreLayer)),
				);

				expect(resolved.retained).toEqual([]);

				for (const path of removedAppPaths)
					expect(await pathExists(join(directory, path))).toBe(false);

				expect(
					await readFile(join(directory, "apps/web/app/page.tsx"), "utf-8"),
				).toBe(files["apps/web/app/page.tsx"]);
			});
		});

		it("explains that accept-forge leaves rewritten files outside the removed root alone", async () => {
			await withTempDir("apply-removed-root-guidance", async (directory) => {
				await writeRemovedAppFixture(directory);

				const error = await Effect.runPromise(
					Effect.flip(
						Apply.applyPlan(directory, await removalPlan(["apps/admin"]), {
							resolutionPolicy: "accept-forge",
						}).pipe(Effect.provide(coreLayer)),
					),
				);

				if (!(error instanceof ApplyError))
					throw new Error("Expected ApplyError");

				expect(formatApplyError(error)).toBe(
					[
						"Forge cannot safely update these files:",
						"apps/web/app/page.tsx was modified after Forge last managed it.",
						"apps/web/app/page.tsx sits outside the app you're removing, so --accept-forge leaves it alone.",
						"Run again with --keep-user to keep your version wherever you and Forge disagree.",
					].join("\n"),
				);
			});
		});

		it("explains that no flag deletes edited files outside the removed root", async () => {
			await withTempDir(
				"apply-removed-root-removal-guidance",
				async (directory) => {
					const shared = "packages/shared/src/index.ts";
					const tools = "packages/tools/src/index.ts";
					await writeText(join(directory, shared), "edited\n");
					await writeText(join(directory, tools), "edited\n");
					await Effect.runPromise(
						State.writeLockfile(directory, {
							schemaVersion: 1,
							artifacts: {
								shared: await opaque(shared, "original\n"),
								tools: await opaque(tools, "original\n"),
							},
						}).pipe(Effect.provide(coreLayer)),
					);

					const error = await Effect.runPromise(
						Effect.flip(
							Apply.applyPlan(
								directory,
								{
									lockfile: { artifacts: {} },
									manifest: { config: {}, installs: [], modules: {} },
									removals: [shared, tools],
									removedRoots: ["apps/admin"],
									writes: [],
								},
								{ resolutionPolicy: "accept-forge" },
							).pipe(Effect.provide(coreLayer)),
						),
					);

					if (!(error instanceof ApplyError))
						throw new Error("Expected ApplyError");

					const message = formatApplyError(error);
					expect(message).toContain(
						`${shared} and ${tools} sit outside the app you're removing, so --accept-forge leaves them alone.`,
					);

					expect(message).toContain(
						`Neither flag resolves ${shared} and ${tools}, so move them out of the way first.`,
					);

					expect(message).not.toContain("Run again with --accept-forge");
					expect(message).not.toContain("--keep-user");
				},
			);
		});

		it("refuses accept-forge everywhere when the removal scope is empty", async () => {
			await withTempDir("apply-removed-root-empty", async (directory) => {
				const { files } = await writeRemovedAppFixture(directory);
				const plan = await removalPlan([]);

				const error = await Effect.runPromise(
					Effect.flip(
						Apply.applyPlan(
							directory,
							{ ...plan, removals: [] },
							{ resolutionPolicy: "accept-forge" },
						).pipe(Effect.provide(coreLayer)),
					),
				);

				expect(error).toMatchObject({
					path: "apps/web/app/page.tsx",
					reason: "managed-file-modified",
				});

				expect(
					await readFile(join(directory, "apps/web/app/page.tsx"), "utf-8"),
				).toBe(files["apps/web/app/page.tsx"]);
			});
		});

		it("does not treat a sibling with the same prefix as removed", async () => {
			await withTempDir("apply-removed-root-prefix", async (directory) => {
				const path = "apps/admin-tools/page.tsx";
				await writeText(join(directory, path), "edited\n");
				await Effect.runPromise(
					State.writeLockfile(directory, {
						schemaVersion: 1,
						artifacts: { tools: await opaque(path, "original\n") },
					}).pipe(Effect.provide(coreLayer)),
				);

				const error = await Effect.runPromise(
					Effect.flip(
						Apply.applyPlan(
							directory,
							{
								lockfile: { artifacts: {} },
								manifest: { config: {}, installs: [], modules: {} },
								removals: [path],
								removedRoots: ["apps/admin"],
								writes: [],
							},
							{ resolutionPolicy: "accept-forge" },
						).pipe(Effect.provide(coreLayer)),
					),
				);

				expect(error).toMatchObject({
					path,
					reason: "managed-file-modified",
				});
			});
		});

		it("retains relocated edits under the disk root", async () => {
			await withTempDir("apply-removed-root-relocated", async (directory) => {
				await writeText(join(directory, "apps/dashboard/page.tsx"), "edited\n");

				await Effect.runPromise(
					State.writeLockfile(directory, {
						schemaVersion: 1,
						artifacts: {
							page: await opaque("apps/admin/page.tsx", "original\n"),
						},
					}).pipe(Effect.provide(coreLayer)),
				);

				const result = await Effect.runPromise(
					Apply.applyPlan(directory, {
						lockfile: { artifacts: {} },
						manifest: { config: {}, installs: [], modules: {} },
						removalRootRelocations: { "apps/admin": "apps/dashboard" },
						removals: ["apps/admin/page.tsx"],
						removedRoots: ["apps/dashboard"],
						writes: [],
					}).pipe(Effect.provide(coreLayer)),
				);

				expect(result.retained).toEqual(["apps/dashboard/page.tsx"]);
				expect(
					await readFile(join(directory, "apps/dashboard/page.tsx"), "utf-8"),
				).toBe("edited\n");
			});
		});
	});

	describe("preserved files", () => {
		const routeTree = "apps/web/src/routeTree.gen.ts";
		const stub = "export const routeTree = stub;\n";
		const generated = "export const routeTree = generated;\n";

		const preservedPlan = async (
			generatedFlag = false,
		): Promise<ApplyPlan> => ({
			lockfile: {
				artifacts: {
					"module:web:file:src/routeTree.gen.ts": {
						...(generatedFlag ? { generated: true } : {}),
						definitionIds: ["tanstack-router/base"],
						hash: await hashContent(stub),
						kind: "file",
						path: routeTree,
					},
				},
			},
			manifest: { config: {}, installs: [], modules: {} },
			removals: [],
			writes: [
				{
					artifactId: "module:web:file:src/routeTree.gen.ts",
					content: stub,
					path: routeTree,
					preserveExisting: true,
				},
			],
		});

		it("writes a preserved file only when it is missing", async () => {
			await withTempDir("apply-preserve-missing", async (directory) => {
				await Effect.runPromise(
					Apply.applyPlan(directory, await preservedPlan()).pipe(
						Effect.provide(coreLayer),
					),
				);

				expect(await readFile(join(directory, routeTree), "utf-8")).toBe(stub);
			});
		});

		it("commits the next generated flag when preserving existing bytes", async () => {
			await withTempDir("apply-preserve-generated", async (directory) => {
				const plan = await preservedPlan();
				const nextPlan = await preservedPlan(true);

				await Effect.runPromise(
					State.writeLockfile(directory, {
						schemaVersion: 1,
						artifacts: plan.lockfile.artifacts,
					}).pipe(Effect.provide(coreLayer)),
				);

				await writeText(join(directory, routeTree), generated);

				await Effect.runPromise(
					Apply.applyPlan(directory, nextPlan).pipe(Effect.provide(coreLayer)),
				);

				expect(await readFile(join(directory, routeTree), "utf-8")).toBe(
					generated,
				);

				expect(await readJson(join(directory, ".forge/lock.json"))).toEqual({
					schemaVersion: 1,
					artifacts: nextPlan.lockfile.artifacts,
				});
			});
		});

		it.each([
			{ generatedRemovals: false, removedRoot: true, relocated: false },
			{ generatedRemovals: true, removedRoot: true, relocated: false },
			{ generatedRemovals: true, removedRoot: true, relocated: true },
			{ generatedRemovals: true, removedRoot: false, relocated: false },
		])(
			"handles older generated artifacts with %j",
			async ({ generatedRemovals, removedRoot, relocated }) => {
				await withTempDir("apply-remove-old-generated", async (directory) => {
					const previous = await preservedPlan();
					const currentRoot = relocated ? "apps/site" : "apps/web";
					const currentPath = `${currentRoot}/src/routeTree.gen.ts`;

					await Effect.runPromise(
						State.writeLockfile(directory, {
							schemaVersion: 1,
							artifacts: previous.lockfile.artifacts,
						}).pipe(Effect.provide(coreLayer)),
					);

					await writeText(join(directory, currentPath), generated);

					const applyRemoval = Effect.runPromise(
						Apply.applyPlan(directory, {
							...(generatedRemovals ? { generatedRemovals: [routeTree] } : {}),
							lockfile: { artifacts: {} },
							manifest: { config: {}, installs: [], modules: {} },
							...(relocated
								? { removalRootRelocations: { "apps/web": currentRoot } }
								: {}),
							removals: [routeTree],
							removedRoots: removedRoot ? [currentRoot] : [],
							writes: [],
						}).pipe(Effect.provide(coreLayer)),
					);

					if (!removedRoot) {
						await expect(applyRemoval).rejects.toMatchObject({
							reason: "managed-file-modified",
						});

						expect(await readFile(join(directory, currentPath), "utf-8")).toBe(
							generated,
						);

						return;
					}

					const result = await applyRemoval;
					const removed = generatedRemovals && removedRoot;
					expect(result.retained).toEqual(removed ? [] : [currentPath]);
					expect(await pathExists(join(directory, currentPath))).toBe(!removed);
				});
			},
		);

		it.each([false, true])(
			"removes regenerated files but retains user edits with adopted=%s",
			async (adopted) => {
				await withTempDir("apply-remove-generated", async (directory) => {
					const userFile = "apps/web/src/custom.ts";
					const hash = await hashContent(stub);

					await Effect.runPromise(
						State.writeLockfile(directory, {
							schemaVersion: 1,
							artifacts: {
								routeTree: {
									definitionIds: ["tanstack-router/base"],
									generated: true,
									hash,
									kind: "file",
									path: routeTree,
									...(adopted
										? {
												base: {
													hash,
													mergeKind: "opaque",
													origin: "adopted",
													semanticsVersion: 1,
												},
											}
										: {}),
								},
								custom: {
									definitionIds: ["email/base"],
									hash,
									kind: "file",
									path: userFile,
								},
							},
						}).pipe(Effect.provide(coreLayer)),
					);

					await writeText(join(directory, routeTree), generated);
					await writeText(join(directory, userFile), "user edits\n");

					const result = await Effect.runPromise(
						Apply.applyPlan(directory, {
							lockfile: { artifacts: {} },
							manifest: { config: {}, installs: [], modules: {} },
							removals: [routeTree, userFile],
							removedRoots: ["apps/web"],
							writes: [],
						}).pipe(Effect.provide(coreLayer)),
					);

					expect(result.retained).toEqual([userFile]);
					expect(await pathExists(join(directory, routeTree))).toBe(false);
					expect(await readFile(join(directory, userFile), "utf-8")).toBe(
						"user edits\n",
					);
				});
			},
		);

		it.each(["refuse", "keep-user", "accept-forge"] as const)(
			"keeps an existing preserved file under %s",
			async (resolutionPolicy) => {
				await withTempDir("apply-preserve-existing", async (directory) => {
					await writeText(join(directory, routeTree), generated);
					const previous: Lockfile = {
						schemaVersion: 1,
						artifacts: {
							"module:web:file:src/routeTree.gen.ts": {
								definitionIds: ["tanstack-router/base"],
								hash: await hashContent(stub),
								kind: "file",
								path: routeTree,
							},
						},
					};

					await Effect.runPromise(
						State.writeLockfile(directory, previous).pipe(
							Effect.provide(coreLayer),
						),
					);

					await Effect.runPromise(
						Apply.applyPlan(directory, await preservedPlan(), {
							resolutionPolicy,
						}).pipe(Effect.provide(coreLayer)),
					);

					expect(await readFile(join(directory, routeTree), "utf-8")).toBe(
						generated,
					);

					expect(await readJson(join(directory, ".forge/lock.json"))).toEqual(
						previous,
					);
				});
			},
		);

		it("keeps an adopted base on a preserved file until its app is removed", async () => {
			await withTempDir("apply-preserve-adopted", async (directory) => {
				const generatedHash = await hashContent(generated);
				const adopted: LockfileArtifact = {
					base: {
						hash: generatedHash,
						mergeKind: "opaque",
						origin: "adopted",
						semanticsVersion: 1,
					},
					definitionIds: ["tanstack-router/base"],
					hash: generatedHash,
					kind: "file",
					path: routeTree,
				};

				await writeText(join(directory, routeTree), generated);
				await Effect.runPromise(
					Effect.gen(function* () {
						yield* State.writeBase(directory, generatedHash, generated);
						yield* State.writeLockfile(directory, {
							schemaVersion: 1,
							artifacts: { "module:web:file:src/routeTree.gen.ts": adopted },
						});
					}).pipe(Effect.provide(coreLayer)),
				);

				await Effect.runPromise(
					Apply.applyPlan(directory, await preservedPlan()).pipe(
						Effect.provide(coreLayer),
					),
				);

				const lockfile = await readJson<Lockfile>(
					join(directory, ".forge/lock.json"),
				);

				expect(
					lockfile.artifacts["module:web:file:src/routeTree.gen.ts"],
				).toEqual(adopted);

				const removed = await Effect.runPromise(
					Apply.applyPlan(directory, {
						lockfile: { artifacts: {} },
						manifest: { config: {}, installs: [], modules: {} },
						removals: [routeTree],
						removedRoots: ["apps/web"],
						writes: [],
					}).pipe(Effect.provide(coreLayer)),
				);

				expect(removed.retained).toEqual([routeTree]);
				expect(await readFile(join(directory, routeTree), "utf-8")).toBe(
					generated,
				);
			});
		});

		it("keeps a relocated preserved file's artifact", async () => {
			await withTempDir("apply-preserve-relocated", async (directory) => {
				const movedTree = "apps/site/src/routeTree.gen.ts";
				const previous: LockfileArtifact = {
					definitionIds: ["tanstack-router/base"],
					hash: await hashContent(stub),
					kind: "file",
					path: routeTree,
				};

				await writeText(join(directory, movedTree), generated);
				await Effect.runPromise(
					Effect.gen(function* () {
						yield* State.writeLockfile(directory, {
							schemaVersion: 1,
							artifacts: { "module:web:file:src/routeTree.gen.ts": previous },
						});

						yield* State.writeManifest(directory, {
							config: {},
							installs: [],
							modules: {
								web: {
									definitionIds: ["tanstack-router/base"],
									root: "apps/web",
								},
							},
						});
					}).pipe(Effect.provide(coreLayer)),
				);

				const plan = await preservedPlan();
				await Effect.runPromise(
					Apply.applyPlan(directory, {
						...plan,
						lockfile: {
							artifacts: {
								"module:web:file:src/routeTree.gen.ts": {
									...previous,
									path: movedTree,
								},
							},
						},
						manifest: {
							config: {},
							installs: [],
							modules: {
								web: {
									definitionIds: ["tanstack-router/base"],
									root: "apps/site",
								},
							},
						},
						writes: plan.writes.map((write) => ({ ...write, path: movedTree })),
					}).pipe(Effect.provide(coreLayer)),
				);

				const lockfile = await readJson<Lockfile>(
					join(directory, ".forge/lock.json"),
				);

				expect(
					lockfile.artifacts["module:web:file:src/routeTree.gen.ts"],
				).toEqual({ ...previous, path: movedTree });

				expect(await readFile(join(directory, movedTree), "utf-8")).toBe(
					generated,
				);
			});
		});

		it("still refuses an edited neighbour of a preserved file", async () => {
			await withTempDir("apply-preserve-neighbour", async (directory) => {
				const router = "apps/web/src/router.tsx";
				await writeText(join(directory, routeTree), generated);
				await writeText(join(directory, router), "edited\n");
				await Effect.runPromise(
					State.writeLockfile(directory, {
						schemaVersion: 1,
						artifacts: {
							router: {
								definitionIds: ["tanstack-router/base"],
								hash: await hashContent("original\n"),
								kind: "file",
								path: router,
							},
						},
					}).pipe(Effect.provide(coreLayer)),
				);

				const plan = await preservedPlan();
				const error = await Effect.runPromise(
					Effect.flip(
						Apply.applyPlan(directory, {
							...plan,
							writes: [
								...plan.writes,
								{ artifactId: "router", content: "original\n", path: router },
							],
						}).pipe(Effect.provide(coreLayer)),
					),
				);

				expect(error).toMatchObject({
					path: router,
					reason: "managed-file-modified",
				});
			});
		});
	});
});
