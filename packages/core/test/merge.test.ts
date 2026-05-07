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

	it("appends lines without duplicates and respects sections", () => {
		expect(appendLines("# Env\nDATABASE_URL=\n", ["AUTH_SECRET="], "Env")).toBe(
			"# Env\nDATABASE_URL=\nAUTH_SECRET=\n",
		);

		expect(appendLines("tail\n", ["head"], undefined, "start")).toBe(
			"head\ntail\n",
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
});
