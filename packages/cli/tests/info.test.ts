import { getCatalogEntry, listCatalogEntries } from "@ryuujs/generators";
import { describe, expect, it } from "vitest";
import {
	buildInfoEnvelope,
	buildInfoNotFoundMessage,
	buildInfoOutput,
} from "../src/commands/info";

function requireEntry(id: string) {
	const entry = getCatalogEntry(id);
	if (entry === undefined) throw new Error(`Missing test catalog entry: ${id}`);
	return entry;
}

describe("forge info builders", () => {
	it("renders addon, framework, and template rows", () => {
		const addon = buildInfoOutput(requireEntry("trpc"));
		const framework = buildInfoOutput(requireEntry("nextjs"));
		const template = buildInfoOutput(requireEntry("nextjs/base"));

		expect(addon).toContain("Category:        addon");
		expect(addon).toContain("Targets:         Single target");
		expect(addon).toContain("Frameworks:      nextjs and tanstack-start");
		expect(addon).toContain("Required slots:  trpc");
		expect(framework).toContain("Slots:");
		expect(template).toContain("Framework:  nextjs");
		expect(template).toContain("Version:    1");
	});

	it("renders the exact addon card", () => {
		expect(buildInfoOutput(requireEntry("trpc"))).toBe(
			[
				"tRPC trpc",
				"Add tRPC to an app target.",
				"Adds tRPC server and client surfaces to compatible Forge application targets.",
				[
					"Category:        addon",
					"Targets:         Single target",
					"Frameworks:      nextjs and tanstack-start",
					"Required slots:  trpc",
					"Keywords:        api, rpc, trpc, and typescript",
					"",
				].join("\n"),
			].join("\n\n"),
		);
	});

	it("renders the exact announced-entry card", () => {
		expect(buildInfoOutput(requireEntry("authjs"))).toBe(
			`${["Auth.js authjs", "Availability:  Auth.js isn't available yet."].join(
				"\n\n",
			)}\n`,
		);
	});

	it("suggests a visible catalog entry for a misspelled id", () => {
		expect(buildInfoNotFoundMessage("drizle", listCatalogEntries())).toBe(
			'We couldn\'t find "drizle" in the catalog. Did you mean drizzle?',
		);
	});

	it("treats a hidden id as missing", () => {
		expect(buildInfoNotFoundMessage("root", listCatalogEntries())).toMatch(
			/^We couldn't find "root" in the catalog\./,
		);
	});

	it("builds the stable info JSON envelope", () => {
		expect(buildInfoEnvelope(requireEntry("drizzle"))).toMatchInlineSnapshot(`
			{
			  "entry": {
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
			  "forgeListVersion": 1,
			}
		`);
	});
});
