import { runtimes } from "@ryuugg/core";
import { describe, expect, it } from "vitest";
import { catalogEntries, catalogRef, versions } from "../src/versions";

describe("catalogEntries", () => {
	it("emits every selected pinned dependency exactly once", () => {
		const flattened = catalogEntries({
			rpc: "orpc",
			authentication: "better-auth",
			authMethods: ["passkey"],
		}).flatMap((group) => group.entries);

		const names = flattened.map((entry) => entry.name).sort();
		const expected = Object.values(versions)
			.map((entry) => entry.name)
			.sort();

		expect(names).toEqual(expected);
	});

	it("omits passkey and preserves Better Auth without selection", () => {
		const entries = catalogEntries({}).flatMap((group) => group.entries);

		expect(entries.some(({ name }) => name === "@better-auth/passkey")).toBe(
			false,
		);

		expect(entries.find(({ name }) => name === "better-auth")?.version).toBe(
			versions.betterAuth.version,
		);
	});

	it("orders groups and alphabetizes entries within each group", () => {
		const groups = catalogEntries({});

		expect(groups.map((group) => group.group)).toEqual([
			"Framework",
			"UI",
			"Styling",
			"Validation & Env",
			"Database",
			"Utilities",
			"Tooling",
			"Types",
		]);

		for (const { group, entries } of groups) {
			const names = entries.map((entry) => entry.name);

			expect(
				entries.every((entry) => entry.group === group),
				group,
			).toBe(true);
			expect(names, group).toEqual(
				[...names].sort((a, b) => a.localeCompare(b)),
			);
		}
	});

	it("keeps pinned package names unique", () => {
		const names = Object.values(versions).map((entry) => entry.name);

		expect(new Set(names).size).toBe(names.length);
	});

	it.each([undefined, "trpc"] as const)(
		"omits oRPC dependencies when rpc is %s",
		(rpc) => {
			expect(
				catalogEntries({ rpc })
					.flatMap((group) => group.entries)
					.some((entry) => entry.name.startsWith("@orpc/")),
			).toBe(false);
		},
	);
});

describe("catalogRef", () => {
	it("maps the key to its entry name and version with an empty catalog", () => {
		const ref = catalogRef("next");

		expect(ref.name).toBe("next");
		expect(ref.version).toBe(versions.next.version);
		expect(ref.version).not.toBe(ref.name);
		expect(ref.catalog).toBe("");
	});
});

describe("Tailwind Vite", () => {
	it("pins the version verified against the official TanStack scaffold", () => {
		expect(versions.tailwindVite).toEqual({
			name: "@tailwindcss/vite",
			version: "^4.1.18",
			group: "Styling",
		});
	});
});

describe("typesNode", () => {
	it("tracks the current Node.js major within the supported range", () => {
		const match = versions.typesNode.version.match(/^\^(\d+)\.0\.0$/);

		expect(match).toBeTruthy();
		if (match === null) throw new Error("Expected a Node types version range");

		const major = Number(match[1]);

		expect(major).toBe(Number(process.versions.node.split(".")[0]));
		expect(major).toBeGreaterThanOrEqual(runtimes.node.minimumMajor);
	});
});
