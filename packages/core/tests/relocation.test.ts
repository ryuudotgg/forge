import { describe, expect, it } from "vitest";
import type { DiscoveredModule, Lockfile, Manifest } from "../src/index";
import {
	moveModules,
	relocateArtifactId,
	relocateInstalls,
	relocateLockfile,
	relocatePath,
	retainedModuleArtifacts,
	rootChanges,
	sourcePath,
} from "../src/relocation";

const previous: Manifest["modules"] = {
	abcde: { root: "apps/web", definitionIds: ["nextjs/base"] },
	fghij: { root: "apps/site", definitionIds: [] },
	klmno: { definitionIds: [] },
};

const next: Manifest["modules"] = {
	abcde: { root: "apps/vault", definitionIds: ["nextjs/base"] },
	fghij: { root: "apps/site", definitionIds: [] },
	klmno: { root: "apps/new", definitionIds: [] },
	pqrst: { root: "apps/added", definitionIds: [] },
};

const changes = rootChanges(previous, next);
const move = { moduleId: "abcde", from: "apps/web", to: "apps/vault" };

describe("root relocation", () => {
	it("finds only changed roots belonging to the same module", () => {
		expect([...changes]).toEqual([
			["abcde", { from: "apps/web", to: "apps/vault" }],
		]);

		expect([...rootChanges(previous, {})]).toEqual([]);
	});

	it.each([
		["apps/web", "apps/vault"],
		["apps/web/src/page.tsx", "apps/vault/src/page.tsx"],
		["apps/webhooks/index.ts", "apps/webhooks/index.ts"],
		["other/apps/web", "other/apps/web"],
		["forge.json", "forge.json"],
	])("relocates %s to %s on path boundaries", (path, expected) => {
		expect(relocatePath(path, changes)).toBe(expected);
	});

	it("prefers the longest prefix without cascading relocations", () => {
		const overlapping = new Map([
			["abcde", { from: "apps/web", to: "apps/vault" }],
			["fghij", { from: "apps/web/docs", to: "sites/docs" }],
			["klmno", { from: "apps/vault", to: "apps/final" }],
		]);

		expect(relocatePath("apps/web/docs/page.tsx", overlapping)).toBe(
			"sites/docs/page.tsx",
		);

		expect(relocatePath("apps/web/page.tsx", overlapping)).toBe(
			"apps/vault/page.tsx",
		);
	});

	it("relocates leaf ids but leaves marker and surface ids alone", () => {
		expect(
			relocateArtifactId("module:abcde:file:apps/web/logo.png", changes),
		).toBe("module:abcde:file:apps/vault/logo.png");

		for (const id of [
			"module:abcde:file:forge.json",
			"module:abcde:surface:page",
			"project:file:apps/web/logo.png",
			"unknown",
		])
			expect(relocateArtifactId(id, changes)).toBe(id);
	});

	it("keeps content addressed bases and the original lock intact", () => {
		const base = {
			hash: "base",
			mergeKind: "opaque",
			semanticsVersion: 1,
		} satisfies NonNullable<Lockfile["artifacts"][string]["base"]>;

		const lock: Lockfile = {
			schemaVersion: 1,
			artifacts: {
				"module:abcde:file:apps/web/logo.png": {
					kind: "file",
					path: "apps/web/logo.png",
					definitionIds: [],
					hash: "hash",
					base,
				},
			},
		};

		const relocated = relocateLockfile(lock, changes);

		expect(
			relocated.artifacts["module:abcde:file:apps/vault/logo.png"],
		).toEqual({
			...lock.artifacts["module:abcde:file:apps/web/logo.png"],
			path: "apps/vault/logo.png",
		});

		expect(
			relocated.artifacts["module:abcde:file:apps/vault/logo.png"]?.base,
		).toBe(base);

		expect(Object.keys(lock.artifacts)).toEqual([
			"module:abcde:file:apps/web/logo.png",
		]);
	});

	it.each(["module:abcde:file:apps/vault/page", "module:fghij:surface:page"])(
		"refuses a collision at %s",
		(id) => {
			const artifact = {
				kind: "file",
				definitionIds: [],
				hash: "hash",
				path: "apps/web/page",
			} satisfies Lockfile["artifacts"][string];

			const lock: Lockfile = {
				schemaVersion: 1,
				artifacts: {
					"module:abcde:file:apps/web/page": artifact,
					[id]: { ...artifact, path: "apps/vault/page" },
				},
			};

			expect(() => relocateLockfile(lock, changes)).toThrow(
				"Relocation Collision: apps/vault/page",
			);
		},
	);

	it("drops stale module artifacts before collision checking", () => {
		const artifact = {
			kind: "file",
			definitionIds: [],
			hash: "hash",
			path: "apps/vault/page",
		} satisfies Lockfile["artifacts"][string];

		const lock: Lockfile = {
			schemaVersion: 1,
			artifacts: {
				"module:abcde:file:apps/web/page": {
					...artifact,
					path: "apps/web/page",
				},
				"module:pqrst:surface:page": artifact,
				"project:file:README.md": { ...artifact, path: "README.md" },
			},
		};

		expect(
			Object.keys(
				relocateLockfile(
					retainedModuleArtifacts(lock, nextWithoutStale()),
					changes,
				).artifacts,
			),
		).toEqual(["module:abcde:file:apps/vault/page", "project:file:README.md"]);
	});

	it("moves discovered roots by stable id and changes no other metadata", () => {
		const module: DiscoveredModule = {
			id: "abcde",
			type: "app",
			framework: "nextjs",
			template: { id: "nextjs/base", version: 1 },
			root: "apps/web",
			slots: {},
			packageName: "@acme/web",
		};

		const other = { ...module, id: "fghij", root: "apps/site" };

		expect(moveModules([module, other], [move])).toEqual([
			{ ...module, root: "apps/vault" },
			other,
		]);

		expect(moveModules([other], [move])[0]).toBe(other);
	});

	it("reads destination coordinates at their pending source", () => {
		expect(sourcePath("apps/vault/src/page.tsx", [move])).toBe(
			"apps/web/src/page.tsx",
		);

		expect(sourcePath("apps/vaulted/page.tsx", [move])).toBe(
			"apps/vaulted/page.tsx",
		);

		expect(sourcePath("apps/vault/src/page.tsx", [])).toBe(
			"apps/vault/src/page.tsx",
		);
	});

	it("relocates install version roots without changing target ids", () => {
		const installs: Manifest["installs"] = [
			{
				definitionId: "nextjs/base",
				targets: [{ kind: "module", moduleId: "abcde" }],
				versions: [
					{
						root: "apps/web",
						name: "next",
						section: "dependencies",
						specifier: "latest",
						version: "16.0.0",
					},
				],
			},
			{ definitionId: "root", targets: [{ kind: "project" }] },
		];

		expect(relocateInstalls(installs, changes)).toEqual([
			{
				...installs[0],
				versions: [{ ...installs[0]?.versions?.[0], root: "apps/vault" }],
			},
			installs[1],
		]);

		expect(installs[0]?.versions?.[0]?.root).toBe("apps/web");
	});
});

function nextWithoutStale(): Manifest["modules"] {
	return { abcde: next.abcde ?? { definitionIds: [] } };
}
