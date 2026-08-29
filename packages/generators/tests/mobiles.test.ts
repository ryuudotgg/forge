import { describe, expect, it } from "vitest";
import {
	mobileAppFrameworkIds,
	mobileAppFrameworkInPlay,
} from "../src/registry/mobiles";

describe("mobileAppFrameworkInPlay", () => {
	it("returns the configured mobile app framework id", () => {
		expect(mobileAppFrameworkInPlay({ mobile: "expo" })).toBe("expo");
	});

	it("returns undefined for non-built mobile framework ids", () => {
		expect(
			mobileAppFrameworkInPlay({ mobile: "react-native" }),
		).toBeUndefined();
		expect(mobileAppFrameworkInPlay({ mobile: undefined })).toBeUndefined();
	});
});

describe("mobileAppFrameworkIds", () => {
	it("contains every registered mobile app framework id", () => {
		expect(mobileAppFrameworkIds).toEqual(new Set(["expo"]));
	});
});
