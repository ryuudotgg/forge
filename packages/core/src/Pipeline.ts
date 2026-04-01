import { FileSystem } from "@effect/platform";
import { Effect } from "effect";
import { CyclicDependencyError } from "./Errors";
import type { Generator } from "./Generator";
import * as Lockfile from "./Lockfile";
import type { Manifest } from "./Manifest";
import * as ManifestMod from "./Manifest";
import { resolve } from "./Registry";
import type { ResolvedFile } from "./VirtualFs";
import * as VFS from "./VirtualFs";

export function run<Config extends Record<string, unknown>>(
	config: Config,
	generators: ReadonlyArray<Generator<Config>>,
	projectRoot: string,
) {
	return Effect.gen(function* () {
		const applicable = resolve(config, generators);
		const ordered = yield* topologicalSort(applicable);

		let vfs = VFS.empty();
		for (const generator of ordered) {
			const ops = yield* generator.generate(config);
			vfs = VFS.addOperations(vfs, generator.id, ops);
		}

		const resolved = yield* VFS.resolve(vfs);

		yield* applyToDisk(resolved, projectRoot);

		const lockfile = yield* buildLockfile(resolved, projectRoot);
		yield* Lockfile.write(projectRoot, lockfile);

		const manifest: Manifest = {
			version: 1,
			config,
			generators: ordered.map((g) => ({ id: g.id, version: g.version })),
			commitRef: null,
		};

		yield* ManifestMod.write(projectRoot, manifest);

		return { resolved, manifest, lockfile };
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

function buildLockfile(
	resolved: ReadonlyArray<ResolvedFile>,
	_projectRoot: string,
) {
	return Effect.gen(function* () {
		const files: Record<string, { generatorId: string; hash: string }> = {};

		for (const file of resolved) {
			const hash = yield* hashContent(file.content);
			files[file.path] = {
				generatorId: file.generators[0] ?? "unknown",
				hash: `sha256:${hash}`,
			};
		}

		return { files } satisfies Lockfile.Lockfile;
	});
}

function hashContent(content: string) {
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
				message: `Cyclic Dependency: ${remaining.join(", ")}`,
			});
		}

		return sorted;
	});
}
