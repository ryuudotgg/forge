import { describe, expect, it } from "vitest";
import { unifiedDiff } from "../src/diff";

describe("unifiedDiff", () => {
	it("returns no diff for identical input", () => {
		expect(unifiedDiff("file.txt", "same\n", "same\n")).toBe("");
	});

	it("renders pure insertion", () => {
		expect(unifiedDiff("file.txt", "", "one\ntwo\n")).toBe(
			"--- a/file.txt\n+++ b/file.txt\n@@ -0,0 +1,2 @@\n+one\n+two\n",
		);
	});

	it("renders pure deletion", () => {
		expect(unifiedDiff("file.txt", "one\ntwo\n", "")).toBe(
			"--- a/file.txt\n+++ b/file.txt\n@@ -1,2 +0,0 @@\n-one\n-two\n",
		);
	});

	it("includes three lines of context around a middle change", () => {
		expect(
			unifiedDiff(
				"file.txt",
				"0\n1\n2\n3\nold\n5\n6\n7\n8\n",
				"0\n1\n2\n3\nnew\n5\n6\n7\n8\n",
			),
		).toBe(
			"--- a/file.txt\n+++ b/file.txt\n@@ -2,7 +2,7 @@\n 1\n 2\n 3\n-old\n+new\n 5\n 6\n 7\n",
		);
	});

	it.each([0, 1, 6, 7])(
		"merges hunks separated by %i unchanged lines only when their context touches",
		(gap) => {
			const context = Array.from(
				{ length: gap },
				(_, index) => `${index}\n`,
			).join("");
			const diff = unifiedDiff(
				"file.txt",
				`old\n${context}old\n`,
				`new\n${context}new\n`,
			);
			expect(
				diff.split("\n").filter((line) => line.startsWith("@@")),
			).toHaveLength(gap <= 6 ? 1 : 2);
		},
	);

	it("marks missing trailing newlines on both sides", () => {
		expect(unifiedDiff("file.txt", "old", "new")).toBe(
			"--- a/file.txt\n+++ b/file.txt\n@@ -1 +1 @@\n-old\n\\ No newline at end of file\n+new\n\\ No newline at end of file\n",
		);
	});

	it("reports a trailing newline change", () => {
		expect(unifiedDiff("file.txt", "same", "same\n")).toBe(
			"--- a/file.txt\n+++ b/file.txt\n@@ -1 +1 @@\n-same\n\\ No newline at end of file\n+same\n",
		);
	});

	it("handles a large mostly unchanged file", () => {
		const before = Array.from(
			{ length: 20000 },
			(_, index) => `${index}\n`,
		).join("");
		const after = before.replace("10000\n", "changed\n");
		expect(unifiedDiff("large.txt", before, after)).toBe(
			"--- a/large.txt\n+++ b/large.txt\n@@ -9998,7 +9998,7 @@\n 9997\n 9998\n 9999\n-10000\n+changed\n 10001\n 10002\n 10003\n",
		);
	});

	it("replaces a heavily rewritten file without an unbounded search", () => {
		const before = Array.from(
			{ length: 2500 },
			(_, index) => `user ${index}\n`,
		).join("");
		const after = Array.from(
			{ length: 100 },
			(_, index) => `forge ${index}\n`,
		).join("");
		const lines = unifiedDiff("schema.ts", before, after).split("\n");

		expect(
			lines.filter((line) => line.startsWith("-") && !line.startsWith("---")),
		).toHaveLength(2500);
		expect(
			lines.filter((line) => line.startsWith("+") && !line.startsWith("+++")),
		).toHaveLength(100);
	});
});
