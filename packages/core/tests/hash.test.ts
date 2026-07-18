import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { hashContentHex } from "../src/hash";

interface HashError {
	readonly message: string;
}

function contentHashFailed(): HashError {
	return { message: "Content Hash Failed" };
}

describe("hash", () => {
	it("hashes an empty string with SHA-256", async () => {
		const result = await Effect.runPromise(
			hashContentHex("", contentHashFailed),
		);

		expect(result).toBe(
			"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
		);
	});

	it("hashes hello with SHA-256", async () => {
		const result = await Effect.runPromise(
			hashContentHex("hello", contentHashFailed),
		);

		expect(result).toBe(
			"2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
		);
	});
});
