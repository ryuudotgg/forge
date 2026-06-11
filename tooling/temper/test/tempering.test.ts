import { describe, expect, it } from "vitest";
import {
	formatRange,
	freshSteel,
	isTemperComment,
	lineCoverage,
	metricPct,
	parseAddedLines,
	render,
	tier,
	toRanges,
} from "../tempering.ts";

const TEMPER = { branches: 40, lines: 50 };

function report(lines: number, branches: number) {
	return { branches, lines, name: "@ryuujs/core", temper: TEMPER };
}

describe("parseAddedLines", () => {
	it("collects added lines from a modification hunk", () => {
		const diff = [
			"diff --git a/packages/core/src/a.ts b/packages/core/src/a.ts",
			"--- a/packages/core/src/a.ts",
			"+++ b/packages/core/src/a.ts",
			"@@ -10,2 +12,3 @@",
			"+one",
			"+two",
			"+three",
		].join("\n");

		expect(parseAddedLines(diff).get("packages/core/src/a.ts")).toEqual(
			new Set([12, 13, 14]),
		);
	});

	it("treats an omitted count as one line", () => {
		const diff = ["+++ b/packages/core/src/a.ts", "@@ -5 +6 @@", "+one"].join(
			"\n",
		);

		expect(parseAddedLines(diff).get("packages/core/src/a.ts")).toEqual(
			new Set([6]),
		);
	});

	it("adds nothing for a pure deletion hunk", () => {
		const diff = ["+++ b/packages/core/src/a.ts", "@@ -5,3 +4,0 @@"].join("\n");

		expect(parseAddedLines(diff).get("packages/core/src/a.ts")?.size).toBe(0);
	});

	it("ignores hunks of deleted files", () => {
		const diff = [
			"--- a/packages/core/src/gone.ts",
			"+++ /dev/null",
			"@@ -1,3 +0,0 @@",
		].join("\n");

		expect(parseAddedLines(diff).size).toBe(0);
	});

	it("collects every line of a new file", () => {
		const diff = [
			"--- /dev/null",
			"+++ b/packages/core/src/new.ts",
			"@@ -0,0 +1,2 @@",
			"+one",
			"+two",
		].join("\n");

		expect(parseAddedLines(diff).get("packages/core/src/new.ts")).toEqual(
			new Set([1, 2]),
		);
	});

	it("skips context lines in hunks with context", () => {
		const diff = [
			"+++ b/packages/core/src/a.ts",
			"@@ -10,4 +10,5 @@",
			" context",
			" context",
			"+new line",
			" context",
			" context",
		].join("\n");

		expect(parseAddedLines(diff).get("packages/core/src/a.ts")).toEqual(
			new Set([12]),
		);
	});

	it("tracks the new-side line number across removals", () => {
		const diff = [
			"+++ b/packages/core/src/a.ts",
			"@@ -10,3 +10,3 @@",
			" context",
			"-old line",
			"+new line",
			" context",
		].join("\n");

		expect(parseAddedLines(diff).get("packages/core/src/a.ts")).toEqual(
			new Set([11]),
		);
	});

	it("keeps non-ascii paths intact", () => {
		const diff = [
			"+++ b/packages/core/src/naïve.ts",
			"@@ -1 +1 @@",
			"+one",
		].join("\n");

		expect(parseAddedLines(diff).get("packages/core/src/naïve.ts")).toEqual(
			new Set([1]),
		);
	});

	it("keeps files in one diff apart", () => {
		const diff = [
			"+++ b/packages/core/src/a.ts",
			"@@ -1,0 +2,2 @@",
			"+one",
			"+two",
			"+++ b/packages/core/src/b.ts",
			"@@ -1 +1 @@",
			"+one",
		].join("\n");

		const added = parseAddedLines(diff);
		expect(added.get("packages/core/src/a.ts")).toEqual(new Set([2, 3]));
		expect(added.get("packages/core/src/b.ts")).toEqual(new Set([1]));
	});
});

describe("lineCoverage", () => {
	it("keeps the highest count of statements sharing a start line", () => {
		const coverage = lineCoverage({
			s: { 0: 0, 1: 2, 2: 0 },
			statementMap: {
				0: { start: { line: 3 } },
				1: { start: { line: 3 } },
				2: { start: { line: 5 } },
			},
		});

		expect(coverage).toEqual(
			new Map([
				[3, 2],
				[5, 0],
			]),
		);
	});

	it("returns an empty map for malformed coverage", () => {
		expect(lineCoverage(null).size).toBe(0);
		expect(lineCoverage({}).size).toBe(0);
		expect(lineCoverage({ statementMap: {} }).size).toBe(0);
	});
});

describe("toRanges", () => {
	it("groups consecutive lines into ranges", () => {
		expect(toRanges([5, 3, 4, 9])).toEqual([
			{ end: 5, start: 3 },
			{ end: 9, start: 9 },
		]);
	});

	it("returns no ranges for no lines", () => {
		expect(toRanges([])).toEqual([]);
	});
});

describe("formatRange", () => {
	it("formats a multi-line range", () => {
		expect(formatRange("f.ts", { end: 5, start: 3 })).toBe("f.ts:3-5");
	});

	it("formats a single line without a span", () => {
		expect(formatRange("f.ts", { end: 3, start: 3 })).toBe("f.ts:3");
	});
});

describe("metricPct", () => {
	it("reads a metric total", () => {
		const summary = { total: { lines: { pct: 79.23 } } };
		expect(metricPct(summary, "lines", "x.json")).toBe(79.23);
	});

	it("throws on a summary without the metric", () => {
		expect(() => metricPct({ total: {} }, "branches", "x.json")).toThrow(
			"Malformed Coverage Summary: no branches total in x.json",
		);
	});
});

describe("tier", () => {
	it("burns bright at or above both thresholds", () => {
		expect(tier(report(50, 40))).toBe("🔥");
	});

	it("cools to orange within ninety percent of both thresholds", () => {
		expect(tier(report(45, 36))).toBe("🟠");
		expect(tier(report(48, 38))).toBe("🟠");
	});

	it("freezes below the window on either metric", () => {
		expect(tier(report(44.9, 36))).toBe("🧊");
		expect(tier(report(45, 35.9))).toBe("🧊");
	});
});

describe("isTemperComment", () => {
	it("matches a body that starts with the marker", () => {
		expect(
			isTemperComment("<!-- temper-report -->\n\n## ⚒️ Temper Report"),
		).toBe(true);
	});

	it("rejects a quote-reply of the report", () => {
		expect(isTemperComment("> <!-- temper-report -->\n> quoted")).toBe(false);
	});

	it("rejects a comment mentioning the marker inline", () => {
		expect(isTemperComment("reply about <!-- temper-report --> usage")).toBe(
			false,
		);
	});
});

describe("freshSteel", () => {
	it("reports nothing to temper without measured lines", () => {
		expect(freshSteel(0, 0, [])).toBe(
			"**Fresh Steel:** nothing to temper (this diff changes no measured lines).",
		);
	});

	it("reports full temper without brittle lines", () => {
		expect(freshSteel(3, 0, [])).toBe(
			"**Fresh Steel:** fully tempered with 3 changed lines covered.",
		);
	});

	it("keeps a single changed line singular", () => {
		expect(freshSteel(1, 0, [])).toBe(
			"**Fresh Steel:** fully tempered with 1 changed line covered.",
		);
	});

	it("reports the tempered percentage and brittle refs", () => {
		expect(freshSteel(1, 2, ["a.ts:1", "a.ts:3"])).toBe(
			"**Fresh Steel:** 33.3% tempered with 2 brittle lines in `a.ts:1` and `a.ts:3`.",
		);
	});

	it("caps the listed refs at eight", () => {
		const refs = Array.from({ length: 10 }, (_, i) => `a.ts:${i + 1}`);
		expect(freshSteel(0, 10, refs)).toBe(
			"**Fresh Steel:** 0.0% tempered with 10 brittle lines in `a.ts:1`, `a.ts:2`, `a.ts:3`, `a.ts:4`, `a.ts:5`, `a.ts:6`, `a.ts:7`, `a.ts:8`, and 2 more.",
		);
	});
});

describe("render", () => {
	it("renders the marker, the table, and the fresh steel line", () => {
		expect(render([report(80, 70)], 0, 0, [])).toBe(
			[
				"<!-- temper-report -->",
				"",
				"## ⚒️ Temper Report",
				"",
				"| Package | Temper | Branches |",
				"| --- | --- | --- |",
				"| `@ryuujs/core` | 🔥 80.0% | 70.0% |",
				"",
				"**Fresh Steel:** nothing to temper (this diff changes no measured lines).",
			].join("\n"),
		);
	});
});
