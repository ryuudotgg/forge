import { describe, expect, it } from "vitest";
import { getCatalogEntry, matchQuery } from "../src/index";

function requireEntry(id: string) {
	const entry = getCatalogEntry(id);
	if (entry === undefined) throw new Error(`Missing test catalog entry: ${id}`);
	return entry;
}

describe("matchQuery", () => {
	const drizzle = requireEntry("drizzle");

	it("matches ids and names", () => {
		expect(matchQuery(drizzle, "drizzle")).toBe(true);
		expect(matchQuery(drizzle, "Drizzle")).toBe(true);
	});

	it("matches summaries and descriptions", () => {
		expect(matchQuery(drizzle, "ORM support")).toBe(true);
		expect(matchQuery(drizzle, "database tooling")).toBe(true);
	});

	it("matches keywords case-insensitively", () => {
		expect(matchQuery(drizzle, "SQL")).toBe(true);
	});

	it("matches an empty query and rejects unrelated text", () => {
		expect(matchQuery(drizzle, "")).toBe(true);
		expect(matchQuery(drizzle, "authentication")).toBe(false);
	});
});
