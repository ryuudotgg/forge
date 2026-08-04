import { describe, expect, it } from "vitest";
import { resolutionArguments } from "../src/commands/resolution";

describe("resolution arguments", () => {
	it("keeps the unflagged lifecycle call shape unchanged", () => {
		expect(resolutionArguments({})).toEqual([]);
	});

	it("maps lifecycle flags to typed apply options", () => {
		expect(resolutionArguments({ "keep-user": true })).toEqual([
			{ resolutionPolicy: "keep-user" },
		]);
		expect(resolutionArguments({ "accept-forge": true })).toEqual([
			{ resolutionPolicy: "accept-forge" },
		]);
	});
});
