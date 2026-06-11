import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { NodeContext } from "@effect/platform-node";
import { Cause, Effect, Exit, Layer, Option } from "effect";
import { describe, expect, it } from "vitest";
import {
	addOperations,
	CoreLive,
	defineGenerator,
	detectConflicts,
	emptyVfs,
	filePath,
	type Generator,
	hashContent,
	Pipeline,
	resolveGenerators,
	resolveVfs,
	run,
	topologicalSort,
	Vfs,
	type VirtualFs,
} from "../src/index";
import { withTempDir } from "./harness";

interface TestConfig extends Record<string, unknown> {
	readonly enabled?: boolean;
}

function makeGenerator(
	id: string,
	options?: {
		readonly appliesTo?: Generator<TestConfig>["appliesTo"];
		readonly category?: Generator<TestConfig>["category"];
		readonly dependencies?: ReadonlyArray<string>;
		readonly exclusive?: boolean;
		readonly ops?: Generator<TestConfig>["generate"];
	},
): Generator<TestConfig> {
	return {
		id,
		name: id,
		version: "0.0.0-test",
		category: options?.category ?? "addon",
		exclusive: options?.exclusive ?? false,
		dependencies: options?.dependencies ?? [],
		appliesTo: options?.appliesTo ?? (() => true),
		generate: options?.ops ?? (() => Effect.succeed([])),
	};
}

function failureOf<A, E>(exit: Exit.Exit<A, E>): E {
	if (!Exit.isFailure(exit)) throw new Error("Expected Failure Exit");

	const failure = Cause.failureOption(exit.cause);
	if (Option.isNone(failure)) throw new Error("Expected Failure Exit");

	return failure.value;
}

function conflictingVfs(first: string, last: string): VirtualFs {
	return addOperations(
		addOperations(emptyVfs(), "a", [
			{
				_tag: "CreateFile",
				path: filePath("package.json"),
				content: first,
			},
		]),
		"b",
		[
			{
				_tag: "CreateFile",
				path: filePath("package.json"),
				content: last,
			},
		],
	);
}

const coreLayer = CoreLive.pipe(Layer.provideMerge(NodeContext.layer));

describe("pipeline and vfs", () => {
	it("detects VFS create conflicts", async () => {
		const conflicts = await Effect.runPromise(
			Vfs.detectConflicts(conflictingVfs("{}", "{}")).pipe(
				Effect.provide(Vfs.Default),
			),
		);

		expect(conflicts).toHaveLength(1);
		expect(conflicts[0]?.path).toBe("package.json");
		expect(conflicts[0]?.generators).toEqual(["a", "b"]);
		expect(conflicts[0]?.message).toBe("File Conflict");
	});

	it("ignores non-create operations when detecting conflicts", async () => {
		const vfs = addOperations(
			addOperations(emptyVfs(), "a", [
				{
					_tag: "CreateFile",
					path: filePath("package.json"),
					content: "{}",
				},
			]),
			"b",
			[
				{
					_tag: "MergeJson",
					path: filePath("package.json"),
					value: { private: true },
					strategy: "deep",
				},
			],
		);

		const conflicts = await Effect.runPromise(detectConflicts(vfs));

		expect(conflicts).toHaveLength(0);
	});

	it("fails VFS resolution with typed aggregate conflicts", async () => {
		const exit = await Effect.runPromiseExit(
			Vfs.resolve(conflictingVfs("{}", "{}")).pipe(Effect.provide(Vfs.Default)),
		);

		const error = failureOf(exit);
		if (error._tag !== "AggregateConflictError")
			throw new Error(`Unexpected Failure Tag: ${error._tag}`);

		expect(error.conflicts).toHaveLength(1);
		expect(error.conflicts[0]?.path).toBe("package.json");
		expect(error.conflicts[0]?.generators).toEqual(["a", "b"]);
		expect(error.message).toBe("File Conflict");
	});

	it("resolves create conflicts by strategy", async () => {
		const vfs = conflictingVfs("first", "last");

		const current = await Effect.runPromise(
			resolveVfs(vfs, { onConflict: "accept-current" }),
		);
		expect(current).toEqual([
			{
				path: filePath("package.json"),
				content: "first",
				generators: ["a", "b"],
			},
		]);

		const incoming = await Effect.runPromise(
			resolveVfs(vfs, { onConflict: "accept-incoming" }),
		);
		expect(incoming).toEqual([
			{
				path: filePath("package.json"),
				content: "last",
				generators: ["a", "b"],
			},
		]);
	});

	it("composes json operations into a sorted package json", async () => {
		let vfs = emptyVfs();
		vfs = addOperations(vfs, "create", [
			{
				_tag: "CreateJson",
				path: filePath("package.json"),
				value: { name: "demo", version: "0.1.0" },
			},
		]);
		vfs = addOperations(vfs, "merge", [
			{
				_tag: "MergeJson",
				path: filePath("package.json"),
				value: { private: true, scripts: { build: "tsc" } },
				strategy: "deep",
			},
		]);
		vfs = addOperations(vfs, "scripts", [
			{
				_tag: "AddScripts",
				path: filePath("package.json"),
				scripts: { dev: "vite" },
			},
		]);
		vfs = addOperations(vfs, "deps", [
			{
				_tag: "AddDependencies",
				path: filePath("package.json"),
				dependencies: [
					{ name: "react", version: "^19.0.0", type: "dependencies" },
					{
						name: "@demo/config",
						version: "workspace:*",
						type: "devDependencies",
					},
				],
			},
		]);

		const resolved = await Effect.runPromise(
			resolveVfs(vfs, {
				dependencyFormat: { useCatalog: false, useWorkspaceProtocol: true },
			}),
		);

		expect(resolved).toEqual([
			{
				path: filePath("package.json"),
				content: `${[
					"{",
					'  "name": "demo",',
					'  "version": "0.1.0",',
					'  "private": true,',
					'  "scripts": {',
					'    "build": "tsc",',
					'    "dev": "vite"',
					"  },",
					'  "dependencies": {',
					'    "react": "^19.0.0"',
					"  },",
					'  "devDependencies": {',
					'    "@demo/config": "workspace:*"',
					"  }",
					"}",
				].join("\n")}\n`,
				generators: ["create", "merge", "scripts", "deps"],
			},
		]);
	});

	it("appends lines to created files", async () => {
		let vfs = emptyVfs();
		vfs = addOperations(vfs, "base", [
			{
				_tag: "CreateFile",
				path: filePath(".gitignore"),
				content: "node_modules\n",
			},
		]);
		vfs = addOperations(vfs, "addon", [
			{
				_tag: "AppendLines",
				path: filePath(".gitignore"),
				lines: ["dist"],
				section: "Build",
			},
		]);

		const resolved = await Effect.runPromise(resolveVfs(vfs));

		expect(resolved).toEqual([
			{
				path: filePath(".gitignore"),
				content: "node_modules\n\n# Build\ndist\n",
				generators: ["base", "addon"],
			},
		]);
	});

	it("fails resolution with a typed parse error for invalid json", async () => {
		let vfs = emptyVfs();
		vfs = addOperations(vfs, "base", [
			{
				_tag: "CreateFile",
				path: filePath("package.json"),
				content: "{invalid",
			},
		]);
		vfs = addOperations(vfs, "addon", [
			{
				_tag: "MergeJson",
				path: filePath("package.json"),
				value: { private: true },
				strategy: "deep",
			},
		]);

		const exit = await Effect.runPromiseExit(resolveVfs(vfs));

		const error = failureOf(exit);
		if (error._tag !== "ParseError")
			throw new Error(`Unexpected Failure Tag: ${error._tag}`);

		expect(error.filePath).toBe("package.json");
		expect(error.message).toMatch(/^File Resolution Failed: /);
	});

	it("orders generators topologically and writes resolved files", async () => {
		await withTempDir("pipeline", async (directory) => {
			const generators = [
				makeGenerator("addon", {
					dependencies: ["base", "missing"],
				}),
				makeGenerator("base", {
					category: "workspace",
					exclusive: true,
					ops: () =>
						Effect.succeed([
							{
								_tag: "CreateFile",
								path: filePath("README.md"),
								content: "base",
							},
						]),
				}),
				makeGenerator("skipped", {
					appliesTo: () => false,
				}),
			] satisfies ReadonlyArray<Generator<TestConfig>>;

			const result = await Effect.runPromise(
				Effect.flatMap(Pipeline, (pipeline) =>
					pipeline.run({}, generators, directory),
				).pipe(Effect.provide(coreLayer)),
			);

			expect(result.ordered.map((generator) => generator.id)).toEqual([
				"base",
				"addon",
			]);

			expect(result.resolved).toEqual([
				{ path: filePath("README.md"), content: "base", generators: ["base"] },
			]);

			await expect(
				readFile(join(directory, "README.md"), "utf-8"),
			).resolves.toBe("base");
		});
	});

	it("fails the pipeline when exclusive generators share a category", async () => {
		await withTempDir("pipeline-exclusive", async (directory) => {
			const generators = [
				makeGenerator("drizzle", { category: "orm", exclusive: true }),
				makeGenerator("prisma", { category: "orm", exclusive: true }),
			] satisfies ReadonlyArray<Generator<TestConfig>>;

			const exit = await Effect.runPromiseExit(
				Effect.flatMap(Pipeline, (pipeline) =>
					pipeline.run({}, generators, directory),
				).pipe(Effect.provide(coreLayer)),
			);

			const error = failureOf(exit);
			if (error._tag !== "ExclusiveCategoryError")
				throw new Error(`Unexpected Failure Tag: ${error._tag}`);

			expect(error.category).toBe("orm");
			expect(error.generators).toEqual(["drizzle", "prisma"]);
			expect(error.message).toBe("Exclusive Category Conflict");
		});
	});

	it("fails topological sorting on dependency cycles", async () => {
		const exit = await Effect.runPromiseExit(
			topologicalSort([
				makeGenerator("a", { dependencies: ["b"] }),
				makeGenerator("b", { dependencies: ["a"] }),
			]),
		);

		const error = failureOf(exit);

		expect(error._tag).toBe("CyclicDependencyError");
		expect(error.cycle).toEqual(["a", "b"]);
		expect(error.message).toBe("Cyclic Dependency Detected");
	});

	it("writes files to disk through the exported run helper", async () => {
		await withTempDir("pipeline-run", async (directory) => {
			const generators = [
				makeGenerator("base", {
					ops: () =>
						Effect.succeed([
							{
								_tag: "CreateFile",
								path: filePath("README.md"),
								content: "base",
							},
						]),
				}),
			] satisfies ReadonlyArray<Generator<TestConfig>>;

			const result = await Effect.runPromise(
				run({}, generators, directory).pipe(Effect.provide(coreLayer)),
			);

			expect(result.ordered.map((generator) => generator.id)).toEqual(["base"]);
			expect(result.resolved).toEqual([
				{ path: filePath("README.md"), content: "base", generators: ["base"] },
			]);

			await expect(
				readFile(join(directory, "README.md"), "utf-8"),
			).resolves.toBe("base");
		});
	});

	it("hashes content through the pipeline service", async () => {
		const hash = await Effect.runPromise(
			Effect.flatMap(Pipeline, (pipeline) =>
				pipeline.hashContent("forge"),
			).pipe(Effect.provide(coreLayer)),
		);

		expect(hash).toBe(
			"71b41d6dd48dc58eba8f5cf9edf30fef6597fdf285a521bb8fcbad4b3d50887d",
		);
	});

	it("hashes content through the exported pipeline helper", async () => {
		const hash = await Effect.runPromise(
			hashContent("forge").pipe(Effect.provide(coreLayer)),
		);

		expect(hash).toBe(
			"71b41d6dd48dc58eba8f5cf9edf30fef6597fdf285a521bb8fcbad4b3d50887d",
		);
	});

	it("filters generators through the standalone registry resolve", () => {
		const applies = makeGenerator("applies");
		const skipped = makeGenerator("skipped", { appliesTo: () => false });

		expect(resolveGenerators({}, [applies, skipped])).toEqual([applies]);
	});

	it("returns the generator unchanged from defineGenerator", () => {
		const generator = makeGenerator("identity");

		expect(defineGenerator(generator)).toBe(generator);
	});
});
