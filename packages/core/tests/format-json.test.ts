import { describe, expect, it } from "vitest";
import { formatJson } from "../src/index";

describe("format json", () => {
	it("serializes null and undefined roots as null", () => {
		expect(formatJson(null)).toBe("null\n");
		expect(formatJson(undefined)).toBe("null\n");
	});

	it("omits undefined object values", () => {
		expect(
			formatJson({ a: null, b: true, c: 1.5, d: undefined }, { compact: true }),
		).toBe('{ "a": null, "b": true, "c": 1.5 }\n');
		expect(formatJson({ a: undefined }, { compact: false })).toBe("{}\n");
	});

	it("inlines short arrays with fallback values", () => {
		expect(formatJson([null, undefined, false, 2])).toBe(
			"[null, null, false, 2]\n",
		);
	});

	it("renders scalars on their own lines without compact inlining", () => {
		expect(formatJson({ a: null, b: true, c: 1.5 }, { compact: false })).toBe(
			`${["{", '  "a": null,', '  "b": true,', '  "c": 1.5', "}"].join("\n")}\n`,
		);
	});

	it("rejects non-finite numbers", () => {
		expect(() => formatJson({ value: Number.NaN }, { compact: true })).toThrow(
			RangeError,
		);
		expect(() => formatJson({ value: Infinity }, { compact: false })).toThrow(
			"JSON Number Must Be Finite: Infinity",
		);
	});
});
