import { mkdir, readFile, stat, symlink } from "node:fs/promises";
import { join } from "node:path";
import { FileSystem, Error as PlatformError } from "@effect/platform";
import { NodeContext } from "@effect/platform-node";
import { Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";
import {
	Apply,
	ApplyError,
	type ApplyPlan,
	CoreLive,
	formatApplyError,
	type Lockfile,
	type LockfileArtifact,
	State,
} from "../src/index";
import { hashContent, readJson, withTempDir, writeText } from "./harness";

async function pathExists(path: string) {
	try {
		await stat(path);
		return true;
	} catch {
		return false;
	}
}

const coreLayer = CoreLive.pipe(Layer.provideMerge(NodeContext.layer));

describe("apply", () => {
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

	it("creates a missing .env", async () => {
		await withTempDir("apply-create-env", async (directory) => {
			const content = 'AUTH_SECRET="generated"\n';

			await Effect.runPromise(
				Apply.applyPlan(directory, {
					lockfile: { artifacts: {} },
					manifest: { config: {}, installs: [], modules: {} },
					removals: [],
					writes: [{ content, path: ".env" }],
				}).pipe(Effect.provide(coreLayer)),
			);

			expect(await readFile(join(directory, ".env"), "utf-8")).toBe(content);
		});
	});

	it("leaves an existing .env unchanged", async () => {
		await withTempDir("apply-user-owned-env", async (directory) => {
			const userContent = 'AUTH_SECRET="user-secret"\n';
			await writeText(join(directory, ".env"), userContent);

			await Effect.runPromise(
				Apply.applyPlan(directory, {
					lockfile: { artifacts: {} },
					manifest: { config: {}, installs: [], modules: {} },
					removals: [],
					writes: [{ content: 'AUTH_SECRET="generated"\n', path: ".env" }],
				}).pipe(Effect.provide(coreLayer)),
			);

			expect(await readFile(join(directory, ".env"), "utf-8")).toBe(
				userContent,
			);
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
			).pipe(Layer.provide(NodeContext.layer));
			const crashingLayer = Layer.mergeAll(Apply.Default, State.Default).pipe(
				Layer.provide(failingFileSystem),
			);
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
			).pipe(Layer.provide(NodeContext.layer));
			const crashingLayer = Layer.mergeAll(Apply.Default, State.Default).pipe(
				Layer.provide(failingFileSystem),
			);
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
					remove: (path: string, options?: FileSystem.RemoveOptions) =>
						path === oldBasePath
							? Effect.fail(
									new PlatformError.SystemError({
										method: "remove",
										module: "FileSystem",
										pathOrDescriptor: path,
										reason: "PermissionDenied",
									}),
								)
							: fileSystem.remove(path, options),
				})),
			).pipe(Layer.provide(NodeContext.layer));
			const gcFailingLayer = Layer.mergeAll(Apply.Default, State.Default).pipe(
				Layer.provide(failingFileSystem),
			);

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
				"Forge cannot safely update these files:\nturbo.json was modified after Forge last managed it.",
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
			});

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

			expect(await readJson(join(directory, ".forge/manifest.json"))).toEqual(
				plan.manifest,
			);

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
});
