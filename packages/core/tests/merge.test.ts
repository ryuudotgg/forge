import { describe, expect, it } from "vitest";
import {
	appendLines,
	mergeJson,
	threeWayMergeJson,
	threeWayMergeLines,
} from "../src/index";

describe("merge helpers", () => {
	it("deep merges objects and de-duplicates arrays", () => {
		expect(
			mergeJson(
				{
					plugins: ["base"],
					scripts: { dev: "vite" },
				},
				{
					plugins: ["base", "react"],
					scripts: { test: "vitest" },
				},
				"deep",
			),
		).toEqual({
			plugins: ["base", "react"],
			scripts: { dev: "vite", test: "vitest" },
		});
	});

	it("replaces top-level values without deep merging for the replace strategy", () => {
		expect(
			mergeJson(
				{
					plugins: ["base"],
					scripts: { dev: "vite" },
				},
				{
					scripts: { test: "vitest" },
				},
				"replace",
			),
		).toEqual({
			plugins: ["base"],
			scripts: { test: "vitest" },
		});
	});

	it("three-way merges independent json changes and reports scalar conflicts", () => {
		const merged = threeWayMergeJson(
			{
				dependencies: { react: "^19.0.0" },
				scripts: { dev: "vite" },
			},
			{
				dependencies: { react: "^19.0.0" },
				scripts: { dev: "vite --host" },
			},
			{
				dependencies: { react: "^19.1.0" },
				scripts: { dev: "vite" },
			},
		);

		expect(merged).toEqual({
			conflicts: [],
			merged: {
				dependencies: { react: "^19.1.0" },
				scripts: { dev: "vite --host" },
			},
		});

		expect(
			threeWayMergeJson(
				{ name: "acme" },
				{ name: "local-acme" },
				{ name: "incoming-acme" },
			),
		).toEqual({
			conflicts: ["name"],
			merged: { name: "incoming-acme" },
		});
	});

	it("three-way merges nested objects and prefixes conflict paths", () => {
		expect(
			threeWayMergeJson(
				{ scripts: { build: "tsc", dev: "vite" } },
				{ scripts: { build: "tsc", dev: "vite --host" } },
				{ scripts: { build: "tsc -b", dev: "vite" } },
			),
		).toEqual({
			conflicts: [],
			merged: { scripts: { build: "tsc -b", dev: "vite --host" } },
		});

		expect(
			threeWayMergeJson(
				{ scripts: { dev: "vite" } },
				{ scripts: { dev: "vite --host" } },
				{ scripts: { dev: "vite --port 4000" } },
			),
		).toEqual({
			conflicts: ["scripts.dev"],
			merged: { scripts: { dev: "vite --port 4000" } },
		});
	});

	it("three-way merges array additions and honors incoming removals", () => {
		expect(
			threeWayMergeJson(
				{ plugins: ["a"] },
				{ plugins: ["a", "b"] },
				{ plugins: ["c", "a"] },
			),
		).toEqual({
			conflicts: [],
			merged: { plugins: ["a", "b", "c"] },
		});

		expect(
			threeWayMergeJson(
				{ plugins: ["a", "b"] },
				{ plugins: ["a", "b", "c"] },
				{ plugins: ["a"] },
			),
		).toEqual({
			conflicts: [],
			merged: { plugins: ["a", "c"] },
		});
	});

	it("appends lines without duplicates and respects sections", () => {
		expect(
			appendLines(
				"# Env\nDATABASE_URL=\n",
				["DATABASE_URL=", "AUTH_SECRET="],
				"Env",
			),
		).toBe("# Env\nDATABASE_URL=\nAUTH_SECRET=\n");

		expect(appendLines("a\n", ["b", "a"])).toBe("a\nb\n");

		expect(appendLines("tail\n", ["head"], undefined, "start")).toBe(
			"head\ntail\n",
		);
	});

	it("creates missing sections and preserves existing ones", () => {
		expect(appendLines("", ["DATABASE_URL="], "Database")).toBe(
			"# Database\nDATABASE_URL=\n",
		);

		expect(
			appendLines(
				"# Env\nDATABASE_URL=\n\n# Auth\nAUTH_SECRET=\n",
				["RESEND_API_KEY="],
				"Email",
			),
		).toBe(
			"# Env\nDATABASE_URL=\n\n# Auth\nAUTH_SECRET=\n\n# Email\nRESEND_API_KEY=\n",
		);
	});

	it("three-way merges independent line insertions and reports concurrent inserts", () => {
		expect(threeWayMergeLines("a\nb\n", "a\nb\nc\n", "x\na\nb\n")).toEqual({
			conflicts: [],
			merged: "x\na\nb\nc\n",
		});

		expect(
			threeWayMergeLines("a\nb\n", "a\nlocal\nb\n", "a\nincoming\nb\n"),
		).toEqual({
			conflicts: ["concurrent insertion"],
			merged: "a\nincoming\nb\n",
		});
	});

	it("three-way merges separate line edits and reports same-segment conflicts", () => {
		expect(
			threeWayMergeLines(
				"a\nb\nc\nd\ne\nf\n",
				"a\nB\nc\nd\ne\nf\n",
				"a\nb\nc\nd\nE\nf\n",
			),
		).toEqual({
			conflicts: [],
			merged: "a\nB\nc\nd\nE\nf\n",
		});

		expect(
			threeWayMergeLines(
				"a\nb\nc\nd\ne\nf\n",
				"a\nB\nc\nd\ne\nf\n",
				"a\nX\nc\nd\ne\nf\n",
			),
		).toEqual({
			conflicts: ["b"],
			merged: "a\nX\nc\nd\ne\nf\n",
		});
	});
});
