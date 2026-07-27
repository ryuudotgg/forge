import { runtimes } from "@ryuujs/core";
import { describe, expect, it } from "vitest";
import { catalogEntries, catalogRef, versions } from "../src/versions";

describe("catalogEntries", () => {
	it("emits every pinned dependency exactly once", () => {
		const flattened = catalogEntries({}).flatMap((group) => group.entries);
		const names = flattened.map((entry) => entry.name).sort();
		const expected = Object.values(versions)
			.map((entry) => entry.name)
			.sort();

		expect(names).toEqual(expected);
	});

	it("orders groups and alphabetizes entries within each group", () => {
		const groups = catalogEntries({});

		expect(groups.map((group) => group.group)).toEqual([
			"Framework",
			"UI",
			"Styling",
			"Validation & Env",
			"Database",
			"Utilities",
			"Tooling",
			"Types",
		]);

		for (const { group, entries } of groups) {
			const names = entries.map((entry) => entry.name);

			expect(
				entries.every((entry) => entry.group === group),
				group,
			).toBe(true);
			expect(names, group).toEqual(
				[...names].sort((a, b) => a.localeCompare(b)),
			);
		}
	});

	it("keeps pinned package names unique", () => {
		const names = Object.values(versions).map((entry) => entry.name);

		expect(new Set(names).size).toBe(names.length);
	});
});

describe("catalogRef", () => {
	it("maps the key to its entry name and version with an empty catalog", () => {
		const ref = catalogRef("next");

		expect(ref.name).toBe("next");
		expect(ref.version).toBe(versions.next.version);
		expect(ref.version).not.toBe(ref.name);
		expect(ref.catalog).toBe("");
	});
});

describe("typesNode", () => {
	it("tracks the current Node.js major within the supported range", () => {
		const match = versions.typesNode.version.match(/^\^(\d+)\.0\.0$/);

		expect(match).toBeTruthy();
		if (match === null) throw new Error("Expected a Node types version range");

		const major = Number(match[1]);

		expect(major).toBe(Number(process.versions.node.split(".")[0]));
		expect(major).toBeGreaterThanOrEqual(runtimes.node.minimumMajor);
	});
});
