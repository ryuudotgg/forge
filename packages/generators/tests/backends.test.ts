import { describe, expect, it } from "vitest";
import {
	standaloneBackendIds,
	standaloneBackendInPlay,
} from "../src/registry/backends";

describe("standaloneBackendInPlay", () => {
	it("returns the configured standalone backend id", () => {
		expect(standaloneBackendInPlay({ backend: "hono" })).toBe("hono");
	});

	it("returns undefined for non-built backend ids", () => {
		expect(standaloneBackendInPlay({ backend: "self" })).toBeUndefined();
		expect(standaloneBackendInPlay({ backend: undefined })).toBeUndefined();
		expect(standaloneBackendInPlay({ backend: "fastify" })).toBeUndefined();
	});
});

describe("standaloneBackendIds", () => {
	it("contains every registered standalone backend id", () => {
		expect(standaloneBackendIds).toEqual(new Set(["hono"]));
	});
});
