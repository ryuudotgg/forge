import type { CatalogEntry } from "@ryuujs/generators";
import { listCatalogEntries } from "@ryuujs/generators";
import { describe, expect, it } from "vitest";
import {
	buildListEnvelope,
	buildListOutput,
	parseCatalogKind,
	selectListEntries,
} from "../src/commands/list";

const catalog = listCatalogEntries();

describe("forge list builders", () => {
	it("groups available entries before one Coming Soon group", () => {
		const output = buildListOutput(catalog, { query: "" });

		expect(output.indexOf("Frameworks")).toBeLessThan(
			output.indexOf("Templates"),
		);
		expect(output.indexOf("Templates")).toBeLessThan(output.indexOf("Addons"));
		expect(output.indexOf("Addons")).toBeLessThan(
			output.indexOf("Coming Soon"),
		);
		expect(output).toContain("React Router");
		expect(output).toContain("react-router         [framework]");
		expect(output).toContain("Auth.js");
		expect(output).toContain("authjs               [addon]");
		expect(output).not.toContain("Root Workspace");
		expect(output).not.toContain("support is coming soon.");
	});

	it("filters by query and kind before grouping", () => {
		const queried = selectListEntries(catalog, {
			query: "authentication",
		});
		const frameworks = selectListEntries(catalog, {
			kind: "framework",
			query: "",
		});

		expect(queried.map((entry) => entry.id)).toContain("better-auth");
		expect(frameworks.every((entry) => entry.kind === "framework")).toBe(true);
		expect(buildListOutput(catalog, { kind: "addon", query: "authjs" })).toBe(
			"Coming Soon\n  Auth.js  authjs  [addon]\n\n1 entry. Run forge info <id> for details.\n",
		);
	});

	it("aligns columns globally across groups", () => {
		const entries: ReadonlyArray<CatalogEntry> = [
			{
				available: true,
				category: "web",
				description: "First framework.",
				experimental: false,
				hidden: false,
				id: "long-id",
				keywords: [],
				kind: "framework",
				name: "A",
				slots: [],
				summary: "First.",
			},
			{
				available: true,
				category: "tooling",
				description: "Second addon.",
				experimental: false,
				hidden: false,
				id: "x",
				keywords: [],
				kind: "addon",
				name: "Longest",
				targetMode: "multiple",
				summary: "Second.",
			},
		];

		expect(buildListOutput(entries, { query: "" })).toBe(
			[
				"Frameworks",
				"  A        long-id  First.",
				"",
				"Addons",
				"  Longest  x        Second.",
				"",
				"2 entries. Run forge info <id> for details.",
				"",
			].join("\n"),
		);
	});

	it("marks experimental entries and pluralizes the footer", () => {
		const entries: ReadonlyArray<CatalogEntry> = [
			{
				available: true,
				category: "web",
				description: "An experimental framework.",
				experimental: true,
				hidden: false,
				id: "future",
				keywords: [],
				kind: "framework",
				name: "Future",
				slots: [],
				summary: "Try the future.",
			},
		];

		expect(buildListOutput(entries, { query: "" })).toContain(
			"Future (experimental)  future  Try the future.",
		);
		expect(buildListOutput(entries, { query: "" })).toContain(
			"1 entry. Run forge info <id> for details.",
		);
		expect(buildListOutput([], { query: "" })).toContain(
			"0 entries. Run forge info <id> for details.",
		);
	});

	it("validates kind values", () => {
		expect(parseCatalogKind("addon")).toBe("addon");
		expect(parseCatalogKind(undefined)).toBeUndefined();
		expect(() => parseCatalogKind("plugin")).toThrow("Catalog Kind Invalid");
	});

	it("builds the stable JSON envelope without hidden entries", () => {
		const envelope = buildListEnvelope(catalog, { query: "" });
		const drizzle = buildListEnvelope(catalog, { query: "drizzle" });

		expect(envelope.entries.some((entry) => entry.id === "root")).toBe(false);
		expect(
			envelope.entries.every((entry) => typeof entry.available === "boolean"),
		).toBe(true);
		expect(JSON.stringify(envelope)).not.toContain("docsUrl");
		expect(drizzle).toMatchInlineSnapshot(`
			{
			  "entries": [
			    {
			      "available": true,
			      "capabilities": [],
			      "category": "orm",
			      "description": "Adds Drizzle ORM configuration, schema surfaces, and database tooling to a compatible app.",
			      "experimental": false,
			      "frameworks": [],
			      "id": "drizzle",
			      "keywords": [
			        "database",
			        "drizzle",
			        "orm",
			        "sql",
			      ],
			      "kind": "addon",
			      "name": "Drizzle",
			      "requiredSlots": [],
			      "summary": "Add Drizzle ORM support.",
			      "targetMode": "single",
			    },
			  ],
			  "forgeListVersion": 1,
			}
		`);
	});
});
