import { describe, expect, it } from "vitest";
import { editDistance } from "../src/utils/edit-distance";

describe("editDistance", () => {
	it.each([
		["", "", 0],
		["", "database", 8],
		["database", "", 8],
		["database", "database", 0],
		["databse", "database", 1],
		["kitten", "sitting", 3],
		["ab", "ba", 2],
		["A", "a", 1],
		["🙂", "", 1],
		["", "🙂", 1],
	])("compares %s and %s", (left, right, distance) => {
		expect(editDistance(left, right)).toBe(distance);
		expect(editDistance(right, left)).toBe(distance);
	});
});
