import { FileSystem } from "@effect/platform";
import { Effect } from "effect";
import { CyclicDependencyError, ExclusiveCategoryError } from "./errors";
import type { Generator } from "./generator";
import { resolve } from "./registry";
import type { ResolvedFile } from "./virtual-fs";
import * as VFS from "./virtual-fs";

export function run<Config extends Record<string, unknown>>(
	config: Config,
	generators: ReadonlyArray<Generator<Config>>,
	projectRoot: string,
) {
	return Effect.gen(function* () {
		const applicable = resolve(config, generators);
		yield* validateExclusivity(applicable);

		const ordered = yield* topologicalSort(applicable);

		let vfs = VFS.empty();
		for (const generator of ordered) {
			const ops = yield* generator.generate(config);
			vfs = VFS.addOperations(vfs, generator.id, ops);
		}

		const resolved = yield* VFS.resolve(vfs, {
			onConflict: "accept-incoming",
		});

		yield* applyToDisk(resolved, projectRoot);

		return { ordered, resolved };
	});
}

function applyToDisk(
	resolved: ReadonlyArray<ResolvedFile>,
	projectRoot: string,
) {
	return Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;

		for (const file of resolved) {
			const fullPath = `${projectRoot}/${file.path}`;
			const dir = fullPath.slice(0, fullPath.lastIndexOf("/"));

			yield* fs.makeDirectory(dir, { recursive: true });
			yield* fs.writeFileString(fullPath, file.content);
		}
	});
}

export function hashContent(content: string) {
	return Effect.gen(function* () {
		const encoder = new TextEncoder();

		const data = encoder.encode(content);
		const buffer = yield* Effect.promise(() =>
			globalThis.crypto.subtle.digest("SHA-256", data),
		);

		return Array.from(new Uint8Array(buffer))
			.map((b) => b.toString(16).padStart(2, "0"))
			.join("");
	});
}

export function validateExclusivity<Config>(
	generators: ReadonlyArray<Generator<Config>>,
) {
	return Effect.gen(function* () {
		const exclusiveByCategory = new Map<string, string[]>();

		for (const gen of generators) {
			if (!gen.exclusive) continue;

			const existing = exclusiveByCategory.get(gen.category) ?? [];
			existing.push(gen.id);

			exclusiveByCategory.set(gen.category, existing);
		}

		for (const [category, ids] of exclusiveByCategory)
			if (ids.length > 1)
				return yield* new ExclusiveCategoryError({
					category,
					generators: ids,
					message: "Exclusive Category Conflict",
				});
	});
}

export function topologicalSort<Config>(
	generators: ReadonlyArray<Generator<Config>>,
) {
	return Effect.gen(function* () {
		const ids = new Set(generators.map((g) => g.id));
		const adjacency = new Map<string, string[]>();
		const inDegree = new Map<string, number>();
		const byId = new Map<string, Generator<Config>>();

		for (const gen of generators) {
			byId.set(gen.id, gen);
			adjacency.set(gen.id, []);
			inDegree.set(gen.id, 0);
		}

		for (const gen of generators)
			for (const dep of gen.dependencies) {
				if (!ids.has(dep)) continue;
				adjacency.get(dep)?.push(gen.id);
				inDegree.set(gen.id, (inDegree.get(gen.id) ?? 0) + 1);
			}

		const queue: string[] = [];
		for (const [id, degree] of inDegree) if (degree === 0) queue.push(id);

		const sorted: Generator<Config>[] = [];

		while (queue.length > 0) {
			const current = queue.shift();
			if (current === undefined) break;

			const gen = byId.get(current);
			if (gen) sorted.push(gen);

			for (const neighbor of adjacency.get(current) ?? []) {
				const newDegree = (inDegree.get(neighbor) ?? 1) - 1;
				inDegree.set(neighbor, newDegree);
				if (newDegree === 0) queue.push(neighbor);
			}
		}

		if (sorted.length !== generators.length) {
			const remaining = generators
				.filter((g) => !sorted.some((s) => s.id === g.id))
				.map((g) => g.id);

			return yield* new CyclicDependencyError({
				cycle: remaining,
				message: "Cyclic Dependency Detected",
			});
		}

		return sorted;
	});
}
