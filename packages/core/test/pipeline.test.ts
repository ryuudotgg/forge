import { NodeContext } from "@effect/platform-node";
import { Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";
import {
	addOperations,
	CoreLive,
	emptyVfs,
	filePath,
	type Generator,
	Pipeline,
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
		appliesTo: () => true,
		generate: options?.ops ?? (() => Effect.succeed([])),
	};
}

const coreLayer = CoreLive.pipe(Layer.provideMerge(NodeContext.layer));

describe("pipeline and vfs", () => {
	it("detects VFS create conflicts", async () => {
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
					_tag: "CreateFile",
					path: filePath("package.json"),
					content: "{}",
				},
			],
		);

		const conflicts = await Effect.runPromise(
			Vfs.detectConflicts(vfs).pipe(Effect.provide(Vfs.Default)),
		);

		expect(conflicts).toHaveLength(1);
		expect(conflicts[0]?.message).toBe("File Conflict");
	});

	it("fails VFS resolution with typed aggregate conflicts", async () => {
		const vfs = {
			operations: new Map([
				[
					filePath("package.json"),
					[
						{
							generatorId: "a",
							operation: {
								_tag: "CreateFile",
								path: filePath("package.json"),
								content: "{}",
							},
						},
						{
							generatorId: "b",
							operation: {
								_tag: "CreateFile",
								path: filePath("package.json"),
								content: "{}",
							},
						},
					],
				],
			]),
		} satisfies VirtualFs;

		await expect(
			Effect.runPromise(Vfs.resolve(vfs).pipe(Effect.provide(Vfs.Default))),
		).rejects.toThrow("File Conflict");
	});

	it("orders generators topologically and writes resolved files", async () => {
		await withTempDir("pipeline", async (directory) => {
			const generators = [
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
				makeGenerator("addon", {
					dependencies: ["base"],
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

			expect(result.resolved).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						path: filePath("README.md"),
						content: "base",
					}),
				]),
			);
		});
	});

	it("hashes content through the pipeline service", async () => {
		const hash = await Effect.runPromise(
			Effect.flatMap(Pipeline, (pipeline) =>
				pipeline.hashContent("forge"),
			).pipe(Effect.provide(coreLayer)),
		);

		expect(hash).toMatch(/^[a-f0-9]{64}$/);
	});
});
