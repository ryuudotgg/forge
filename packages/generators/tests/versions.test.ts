import { readFileSync } from "node:fs";
import { runtimes } from "@ryuugg/core";
import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import type { ForgeConfig } from "../src/config";
import { catalogEntries, catalogRef, versions } from "../src/versions";

describe("tool pins", () => {
	const toolKeys: ReadonlyArray<"biome" | "oxlint" | "oxfmt" | "typescript"> = [
		"biome",
		"oxlint",
		"oxfmt",
		"typescript",
	];

	it("uses digits and dots only for tool versions", () => {
		for (const key of toolKeys) {
			expect(versions[key].version).toMatch(/^\d+(\.\d+)*$/);
		}
	});

	it("keeps exact tool pins discoverable by Renovate", () => {
		const renovate = Schema.decodeUnknownSync(
			Schema.fromJsonString(
				Schema.Struct({
					customManagers: Schema.Array(
						Schema.Struct({
							managerFilePatterns: Schema.Array(Schema.String),
							matchStrings: Schema.Array(Schema.String),
						}),
					),
				}),
			),
		)(
			readFileSync(
				new URL("../../../.github/renovate.json", import.meta.url),
				"utf-8",
			),
		);

		const manager = renovate.customManagers.find(({ managerFilePatterns }) =>
			managerFilePatterns.some((pattern) =>
				new RegExp(pattern.slice(1, -1)).test(
					"packages/generators/src/versions.ts",
				),
			),
		);

		if (manager === undefined) throw new Error("Missing Versions Manager");

		const source = readFileSync(
			new URL("../src/versions.ts", import.meta.url),
			"utf-8",
		);

		const capturedVersions = new Map(
			manager.matchStrings.flatMap((pattern) =>
				Array.from(
					source.matchAll(new RegExp(pattern, "g")),
					(match): [string | undefined, string | undefined] => [
						match.groups?.depName,
						match.groups?.currentValue,
					],
				),
			),
		);

		for (const key of toolKeys) {
			expect(capturedVersions.get(versions[key].name)).toBe(
				versions[key].version,
			);
		}
	});
});

describe("catalogEntries", () => {
	it.each([
		{ linter: "biome", kept: ["@biomejs/biome"], dropped: ["oxfmt", "oxlint"] },
		{ linter: "oxc", kept: ["oxfmt", "oxlint"], dropped: ["@biomejs/biome"] },
		{
			linter: undefined,
			kept: [],
			dropped: ["@biomejs/biome", "oxfmt", "oxlint"],
		},
	] as const)(
		"pins only the $linter linter tools",
		({ linter, kept, dropped }) => {
			const names = catalogEntries({ linter })
				.flatMap((group) => group.entries)
				.map((entry) => entry.name);

			for (const name of kept) expect(names).toContain(name);
			for (const name of dropped) expect(names).not.toContain(name);
		},
	);

	it("emits every selected pinned dependency exactly once", () => {
		const flattened = catalogEntries({
			rpc: "orpc",
			authentication: "better-auth",
			authMethods: ["passkey"],
			linter: "oxc",
		}).flatMap((group) => group.entries);

		const names = flattened.map((entry) => entry.name).sort();
		const expected = Object.values(versions)
			.filter((entry) => !("linter" in entry) || entry.linter === "oxc")
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
	it("keeps the passkey Better Auth pin aligned with its plugin", () => {
		const passkeyConfig: ForgeConfig = {
			authentication: "better-auth",
			authMethods: ["email-password", "passkey"],
			web: "nextjs",
		};

		expect(catalogRef("betterAuth", passkeyConfig).version).toBe(
			versions.betterAuthPasskey.version,
		);
	});

	function scaffoldCatalog() {
		const workspace = readFileSync(
			new URL("../../../pnpm-workspace.yaml", import.meta.url),
			"utf-8",
		);

		const scaffold = /^ {2}scaffold:\n((?: {4}[^\n]*\n|\n)*)/m.exec(
			workspace,
		)?.[1];

		if (scaffold === undefined) throw new Error("Missing Scaffold Catalog");

		return Object.fromEntries(
			Array.from(
				scaffold.matchAll(/^ {4}("[^"]+"|[\w@/.-]+): ([^\s]+)$/gm),
				([, name, version]) => [
					name?.replaceAll('"', ""),
					version?.replaceAll('"', ""),
				],
			),
		);
	}

	it("matches the repository scaffold catalog to the generated lint pins", () => {
		const entries = scaffoldCatalog();

		for (const tool of [versions.biome, versions.oxlint, versions.oxfmt])
			expect(entries[tool.name], tool.name).toBe(tool.version);
	});

	it("matches the repository scaffold catalog to the passkey pins", () => {
		const entries = scaffoldCatalog();

		expect(entries["better-auth"]).toBe(
			catalogRef("betterAuth", {
				authentication: "better-auth",
				authMethods: ["email-password", "passkey"],
				web: "nextjs",
			}).version,
		);

		expect(entries["@better-auth/passkey"]).toBe(
			versions.betterAuthPasskey.version,
		);
	});

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
