import { describe, expect, it } from "vitest";
import { lintScriptFailure, lintScriptsFor } from "../utils/harness";

const passing = { exitCode: 0, stderr: "", stdout: "" };

describe("smoke lint step", () => {
	it.each([
		"Checked 76 files in 324ms. No fixes applied.\nFound 1 warning.",
		"Checked 76 files in 324ms. No fixes applied.\nFound 3 warnings.",
		"Checked 76 files in 324ms. No fixes applied.\nFound 2 infos.",
		"Found 1 warning and 0 errors.\nFinished in 12ms on 40 files with 93 rules using 8 threads.",
	])("fails a zero exit that still reports diagnostics: %s", (stdout) => {
		expect(lintScriptFailure("check", { ...passing, stdout })).toBeDefined();
	});

	it.each([
		"Checked 76 files in 324ms. No fixes applied.",
		"Found 0 warnings and 0 errors.\nFinished in 12ms on 40 files with 93 rules using 8 threads.",
		"✓ No issues found",
	])("passes a clean run: %s", (stdout) => {
		expect(lintScriptFailure("check", { ...passing, stdout })).toBeUndefined();
	});

	it("fails a non-zero exit", () => {
		expect(
			lintScriptFailure("check:ws", { ...passing, exitCode: 1 }),
		).toBeDefined();
	});

	it("fails a project that declares a linter but has no check script", () => {
		expect(() =>
			lintScriptsFor({ config: { linter: "biome" } }, { "check:ws": "sherif" }),
		).toThrow("Missing Check Script: biome");
	});

	it("runs only the workspace check when no linter is declared", () => {
		expect(lintScriptsFor({ config: {} }, { "check:ws": "sherif" })).toEqual([
			"check:ws",
		]);
	});

	it("runs both scripts when the linter has a check script", () => {
		expect(
			lintScriptsFor(
				{ config: { linter: "oxc" } },
				{ check: "oxlint && oxfmt --check", "check:ws": "sherif" },
			),
		).toEqual(["check", "check:ws"]);
	});
});
