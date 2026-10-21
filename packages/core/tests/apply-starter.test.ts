import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { NodeServices } from "@effect/platform-node";
import { Effect, FileSystem, Layer, Schema } from "effect";
import { describe, expect, it } from "vitest";
import {
	Apply,
	ApplyError,
	type ApplyOptions,
	type ApplyPlan,
	CliVersion,
	CoreLive,
	type Lockfile,
	type PlannedWrite,
	State,
} from "../src/index";
import { hashContent, readJson, withTempDir, writeText } from "./harness";

const coreLayer = CoreLive.pipe(
	Layer.provide(Layer.succeed(CliVersion, { version: "test-cli-version" })),
	Layer.provideMerge(NodeServices.layer),
);

const starter = "packages/email/src/templates/welcome.tsx";
const starterId = `project:file:${starter}`;
const managed = "biome.json";
const managedId = `project:file:${managed}`;

interface File {
	readonly kind?: "file" | "surface";
	readonly id: string;
	readonly path: string;
	readonly content: string;
	readonly update?: PlannedWrite["update"];
}

async function planOf(files: ReadonlyArray<File>): Promise<ApplyPlan> {
	const artifacts: Record<string, Lockfile["artifacts"][string]> = {};
	for (const file of files)
		artifacts[file.id] = {
			definitionIds: ["email"],
			hash: await hashContent(file.content),
			kind: file.kind ?? "file",
			path: file.path,
			...(file.update === "starter" ? { update: "starter" } : {}),
		};

	return {
		lockfile: { artifacts },
		manifest: { config: {}, installs: [], modules: {} },
		removals: [],
		writes: files.map((file) => ({
			artifactId: file.id,
			content: file.content,
			path: file.path,
			...(file.update === undefined ? {} : { update: file.update }),
		})),
	};
}

const starterFile = (content: string): File => ({
	id: starterId,
	path: starter,
	content,
	update: "starter",
});

function apply(directory: string, plan: ApplyPlan, options: ApplyOptions = {}) {
	return Effect.runPromise(
		Apply.applyPlan(directory, plan, options).pipe(Effect.provide(coreLayer)),
	);
}

async function lockArtifact(directory: string, id: string) {
	const lock = await readJson<Lockfile>(join(directory, ".forge/lock.json"));
	return lock.artifacts[id];
}

async function ownStarter(directory: string) {
	await apply(directory, await planOf([starterFile("v1\n")]));
	await writeText(join(directory, starter), "mine\n");
	await apply(directory, await planOf([starterFile("v2\n")]));
}

const PreMarkLockfileSchema = Schema.fromJsonString(
	Schema.Struct({
		schemaVersion: Schema.Literal(1),
		artifacts: Schema.Record(
			Schema.String,
			Schema.Struct({
				base: Schema.optional(
					Schema.Struct({
						hash: Schema.String,
						mergeKind: Schema.Literals([
							"json",
							"lines",
							"env",
							"yaml",
							"opaque",
						]),
						origin: Schema.optional(Schema.Literal("adopted")),
						semanticsVersion: Schema.Finite,
					}),
				),
				generated: Schema.optional(Schema.Literal(true)),
				kind: Schema.Literals(["file", "surface"]),
				definitionIds: Schema.Array(Schema.String),
				hash: Schema.String,
				path: Schema.String,
			}),
		),
	}),
);

const preMarkReader = Layer.effect(
	State,
	Effect.gen(function* () {
		const state = yield* State;
		const fs = yield* FileSystem.FileSystem;

		return State.of({
			...state,
			readLockfile: (projectRoot: string) =>
				fs
					.readFileString(join(projectRoot, ".forge/lock.json"))
					.pipe(
						Effect.flatMap(Schema.decodeEffect(PreMarkLockfileSchema)),
						Effect.orDie,
					),
		});
	}),
);

const preMarkLayer = preMarkReader.pipe(Layer.provideMerge(coreLayer));

describe("starter files", () => {
	it.each(["untouched", "edited", "owned"])(
		"handles removal of a %s starter surface",
		async (state) => {
			await withTempDir("apply-starter-surface-removal", async (directory) => {
				const id = "project:surface:welcome";
				const file: File = { ...starterFile("v1\n"), id, kind: "surface" };

				await apply(directory, await planOf([file]));

				if (state !== "untouched")
					await writeText(join(directory, starter), "mine\n");

				if (state === "owned")
					await apply(directory, await planOf([{ ...file, content: "v2\n" }]));

				const result = await apply(directory, {
					...(await planOf([])),
					removals: [starter],
				});

				expect(result).toEqual({
					declined: [],
					dropped: [],
					released: [],
					retained: state === "untouched" ? [] : [starter],
				});

				expect(await lockArtifact(directory, id)).toBeUndefined();

				if (state === "untouched")
					await expect(
						readFile(join(directory, starter), "utf-8"),
					).rejects.toThrow();
				else
					expect(await readFile(join(directory, starter), "utf-8")).toBe(
						"mine\n",
					);
			});
		},
	);

	it.each(["file", "surface"] satisfies ReadonlyArray<"file" | "surface">)(
		"updates an untouched starter %s, then leaves it to the user once edited",
		async (kind) => {
			const starterId =
				kind === "surface"
					? "project:surface:welcome"
					: `project:file:${starter}`;

			const starterFile = (content: string): File => ({
				id: starterId,
				path: starter,
				content,
				kind,
				update: "starter",
			});

			await withTempDir("apply-starter", async (directory) => {
				const path = join(directory, starter);

				await apply(directory, await planOf([starterFile("v1\n")]));
				const untouched = await apply(
					directory,
					await planOf([starterFile("v2\n")]),
				);

				expect(await readFile(path, "utf-8")).toBe("v2\n");
				expect(untouched.released).toEqual([]);

				await writeText(path, "mine\n");
				const edited = await apply(
					directory,
					await planOf([starterFile("v3\n")]),
				);

				expect(await readFile(path, "utf-8")).toBe("mine\n");
				expect(edited.released).toEqual([starter]);
				expect(await lockArtifact(directory, starterId)).toEqual({
					definitionIds: ["email"],
					hash: await hashContent("v2\n"),
					kind,
					owner: "user",
					path: starter,
					update: "starter",
				});

				const owned = await apply(
					directory,
					await planOf([starterFile("v4\n")]),
				);

				expect(await readFile(path, "utf-8")).toBe("mine\n");
				expect(owned.released).toEqual([]);
				expect(owned).toEqual({
					declined: [],
					dropped: [],
					released: [],
					retained: [],
				});

				expect((await lockArtifact(directory, starterId))?.owner).toBe("user");

				await rm(path);
				const restored = await apply(
					directory,
					await planOf([starterFile("v4\n")]),
				);

				expect(await readFile(path, "utf-8")).toBe("v4\n");
				expect(restored.released).toEqual([]);
				expect(
					(await lockArtifact(directory, starterId))?.owner,
				).toBeUndefined();

				await apply(directory, await planOf([starterFile("v5\n")]));
				expect(await readFile(path, "utf-8")).toBe("v5\n");
			});
		},
	);

	it("hands over a starter edited while Forge's render stays the same", async () => {
		await withTempDir("apply-starter-same-render", async (directory) => {
			await apply(directory, await planOf([starterFile("v1\n")]));
			await writeText(join(directory, starter), "mine\n");

			const result = await apply(
				directory,
				await planOf([starterFile("v1\n")]),
			);

			expect(result.released).toEqual([starter]);
			expect((await lockArtifact(directory, starterId))?.hash).toBe(
				await hashContent("v1\n"),
			);
		});
	});

	it("compares a declined starter against Forge's render, not the recorded bytes", async () => {
		await withTempDir("apply-starter-declined-base", async (directory) => {
			await writeText(join(directory, starter), "mine\n");
			await Effect.runPromise(
				State.writeLockfile(directory, {
					schemaVersion: 1,
					artifacts: {
						[starterId]: {
							base: {
								hash: await hashContent("v1\n"),
								mergeKind: "opaque",
								semanticsVersion: 1,
							},
							definitionIds: ["email"],
							hash: await hashContent("mine\n"),
							kind: "file",
							path: starter,
							update: "starter",
						},
					},
				}).pipe(Effect.provide(coreLayer)),
			);

			const result = await apply(
				directory,
				await planOf([starterFile("v2\n")]),
			);

			expect(await readFile(join(directory, starter), "utf-8")).toBe("mine\n");

			expect(result.released).toEqual([starter]);
			expect((await lockArtifact(directory, starterId))?.hash).toBe(
				await hashContent("v1\n"),
			);
		});
	});

	it("keeps user ownership when Forge plans the path as a managed file", async () => {
		await withTempDir("apply-starter-now-managed", async (directory) => {
			await ownStarter(directory);

			const result = await apply(
				directory,
				await planOf([{ id: starterId, path: starter, content: "v3\n" }]),
				{ resolutionPolicy: "accept-forge" },
			);

			expect(await readFile(join(directory, starter), "utf-8")).toBe("mine\n");

			expect(result.released).toEqual([]);
			expect((await lockArtifact(directory, starterId))?.owner).toBe("user");
		});
	});

	it("keeps a user owned starter under accept-forge while managed files take Forge's version", async () => {
		await withTempDir("apply-starter-accept-forge", async (directory) => {
			const managedFile = (content: string): File => ({
				id: managedId,
				path: managed,
				content,
			});

			await apply(
				directory,
				await planOf([starterFile("v1\n"), managedFile("forge 1\n")]),
			);

			await writeText(join(directory, starter), "mine\n");
			await apply(
				directory,
				await planOf([starterFile("v2\n"), managedFile("forge 1\n")]),
			);

			await writeText(join(directory, managed), "user edit\n");
			const result = await apply(
				directory,
				await planOf([starterFile("v3\n"), managedFile("forge 2\n")]),
				{ resolutionPolicy: "accept-forge" },
			);

			expect(await readFile(join(directory, managed), "utf-8")).toBe(
				"forge 2\n",
			);

			expect(await readFile(join(directory, starter), "utf-8")).toBe("mine\n");

			expect(result.released).toEqual([]);
		});
	});

	it.each([{ owned: true }, { owned: false }])(
		"keeps and reports an edited starter when Forge stops planning it, %j",
		async ({ owned }) => {
			await withTempDir("apply-starter-removal", async (directory) => {
				await apply(directory, await planOf([starterFile("v1\n")]));
				await writeText(join(directory, starter), "mine\n");
				if (owned) await apply(directory, await planOf([starterFile("v2\n")]));

				const result = await apply(
					directory,
					{ ...(await planOf([])), removals: [starter] },
					{ resolutionPolicy: "accept-forge" },
				);

				expect(await readFile(join(directory, starter), "utf-8")).toBe(
					"mine\n",
				);

				expect(result).toEqual({
					declined: [],
					dropped: [],
					released: [],
					retained: [starter],
				});

				expect(await lockArtifact(directory, starterId)).toBeUndefined();
			});
		},
	);

	it("removes an untouched starter when Forge stops planning it", async () => {
		await withTempDir("apply-starter-removal-untouched", async (directory) => {
			await apply(directory, await planOf([starterFile("v1\n")]));
			await apply(directory, { ...(await planOf([])), removals: [starter] });

			await expect(
				readFile(join(directory, starter), "utf-8"),
			).rejects.toThrow();
		});
	});

	it("hands an existing file at a starter path to the user", async () => {
		await withTempDir("apply-starter-unmanaged", async (directory) => {
			await writeText(join(directory, starter), "mine\n");

			const result = await apply(
				directory,
				await planOf([starterFile("v1\n")]),
			);

			expect(await readFile(join(directory, starter), "utf-8")).toBe("mine\n");

			expect(result.released).toEqual([starter]);
			expect((await lockArtifact(directory, starterId))?.owner).toBe("user");
		});
	});

	it("refuses naming the starter when a reader that predates the mark meets it", async () => {
		await withTempDir("apply-starter-pre-mark", async (directory) => {
			await ownStarter(directory);

			const read = await Effect.runPromise(
				State.readLockfile(directory).pipe(Effect.provide(preMarkLayer)),
			);

			expect(read.artifacts[starterId]).toEqual({
				definitionIds: ["email"],
				hash: await hashContent("v1\n"),
				kind: "file",
				path: starter,
			});

			const error = await Effect.runPromise(
				Apply.applyPlan(
					directory,
					await planOf([{ id: starterId, path: starter, content: "v3\n" }]),
				).pipe(Effect.provide(preMarkLayer)),
			).then(
				() => undefined,
				(cause: unknown) => cause,
			);

			expect(error).toBeInstanceOf(ApplyError);
			expect(error).toMatchObject({
				path: starter,
				reason: "managed-file-modified",
			});

			expect(await readFile(join(directory, starter), "utf-8")).toBe("mine\n");
		});
	});
});
