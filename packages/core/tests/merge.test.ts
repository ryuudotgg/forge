import { describe, expect, it } from "vitest";
import {
	appendLines,
	type ConflictResolution,
	envResidue,
	jsonResidue,
	mergeJson,
	parseSections,
	sectionResidue,
	threeWayMergeEnv,
	threeWayMergeJson,
	threeWayMergeLines,
	threeWayMergeSections,
} from "../src/index";

describe("merge helpers", () => {
	it("deep merges objects and de-duplicates arrays", () => {
		expect(
			mergeJson(
				{
					plugins: ["base"],
					scripts: { dev: "vite" },
				},
				{
					plugins: ["base", "react"],
					scripts: { test: "vitest" },
				},
				"deep",
			),
		).toEqual({
			plugins: ["base", "react"],
			scripts: { dev: "vite", test: "vitest" },
		});
	});

	it("de-duplicates structurally equal array values", () => {
		expect(
			mergeJson(
				{ plugins: ["base", { name: "react" }, ["tailwind"]] },
				{ plugins: ["base", { name: "react" }, ["tailwind"], "next"] },
				"deep",
			),
		).toEqual({
			plugins: ["base", { name: "react" }, ["tailwind"], "next"],
		});
	});

	it("replaces top-level values without deep merging for the replace strategy", () => {
		expect(
			mergeJson(
				{
					plugins: ["base"],
					scripts: { dev: "vite" },
				},
				{
					scripts: { test: "vitest" },
				},
				"replace",
			),
		).toEqual({
			plugins: ["base"],
			scripts: { test: "vitest" },
		});
	});

	it("three-way merges independent json changes and reports scalar conflicts", () => {
		const merged = threeWayMergeJson(
			{
				dependencies: { react: "^19.0.0" },
				scripts: { dev: "vite" },
			},
			{
				dependencies: { react: "^19.0.0" },
				scripts: { dev: "vite --host" },
			},
			{
				dependencies: { react: "^19.1.0" },
				scripts: { dev: "vite" },
			},
		);

		expect(merged).toEqual({
			conflicts: [],
			merged: {
				dependencies: { react: "^19.1.0" },
				scripts: { dev: "vite --host" },
			},
		});

		expect(
			threeWayMergeJson(
				{ name: "acme" },
				{ name: "local-acme" },
				{ name: "incoming-acme" },
			),
		).toEqual({
			conflicts: [["name"]],
			merged: { name: "incoming-acme" },
		});
	});

	it("three-way merges nested objects and prefixes conflict paths", () => {
		expect(
			threeWayMergeJson(
				{ scripts: { build: "tsc", dev: "vite" } },
				{ scripts: { build: "tsc", dev: "vite --host" } },
				{ scripts: { build: "tsc -b", dev: "vite" } },
			),
		).toEqual({
			conflicts: [],
			merged: { scripts: { build: "tsc -b", dev: "vite --host" } },
		});

		expect(
			threeWayMergeJson(
				{ scripts: { dev: "vite" } },
				{ scripts: { dev: "vite --host" } },
				{ scripts: { dev: "vite --port 4000" } },
			),
		).toEqual({
			conflicts: [["scripts", "dev"]],
			merged: { scripts: { dev: "vite --port 4000" } },
		});
	});

	it("keeps dotted json keys distinct in conflict paths", () => {
		expect(
			threeWayMergeJson(
				{ scripts: { "dev.web": "vite" } },
				{ scripts: { "dev.web": "vite --host" } },
				{ scripts: { "dev.web": "vite --port 4000" } },
			),
		).toMatchObject({ conflicts: [["scripts", "dev.web"]] });
	});

	it("treats object key order as equal inside arrays", () => {
		expect(
			threeWayMergeJson(
				{ plugins: [{ name: "react", options: { fast: true } }] },
				{ plugins: [{ options: { fast: true }, name: "react" }] },
				{ plugins: [{ name: "react", options: { fast: true } }, "next"] },
			),
		).toEqual({
			conflicts: [],
			merged: {
				plugins: [{ name: "react", options: { fast: true } }, "next"],
			},
		});
	});

	it("three-way merges array additions and honors incoming removals", () => {
		expect(
			threeWayMergeJson(
				{ plugins: ["a"] },
				{ plugins: ["a", "b"] },
				{ plugins: ["c", "a"] },
			),
		).toEqual({
			conflicts: [],
			merged: { plugins: ["a", "b", "c"] },
		});

		expect(
			threeWayMergeJson(
				{ plugins: ["a", "b"] },
				{ plugins: ["a", "b", "c"] },
				{ plugins: ["a"] },
			),
		).toEqual({
			conflicts: [],
			merged: { plugins: ["a", "c"] },
		});
	});

	it("honors user array and dependency removals", () => {
		expect(
			threeWayMergeJson(
				{ plugins: ["a", "b"] },
				{ plugins: ["a"] },
				{ plugins: ["a", "b", "c"] },
			),
		).toEqual({ conflicts: [], merged: { plugins: ["a", "c"] } });

		expect(
			threeWayMergeJson(
				{ dependencies: { react: "19.0.0" } },
				{ dependencies: {} },
				{ dependencies: { react: "19.1.0" } },
				{ preserveDependencyRemovals: true },
			),
		).toEqual({ conflicts: [], merged: { dependencies: {} } });
	});

	it("conflicts on divergent modifications to the same generic array entry", () => {
		expect(
			threeWayMergeJson(
				{ commands: ["build --fast"] },
				{ commands: ["build --user"] },
				{ commands: ["build --forge"] },
			),
		).toEqual({
			conflicts: [["commands"]],
			merged: { commands: ["build --forge"] },
		});
		expect(
			threeWayMergeJson(
				{ commands: ["build --fast"] },
				{ commands: ["build --forge"] },
				{ commands: ["build --user"] },
			),
		).toMatchObject({ conflicts: [["commands"]] });
		expect(
			threeWayMergeJson(
				{ commands: ["build", "test"] },
				{ commands: ["build --user", "test"] },
				{ commands: ["build", "test --forge"] },
			),
		).toEqual({
			conflicts: [],
			merged: { commands: ["build --user", "test --forge"] },
		});

		expect(
			threeWayMergeJson(
				{ commands: ["build --fast"] },
				{ commands: ["build --fast", "test --user"] },
				{ commands: ["build --fast", "lint --forge"] },
			),
		).toEqual({
			conflicts: [],
			merged: {
				commands: ["build --fast", "test --user", "lint --forge"],
			},
		});
	});

	it("merges a removed dependency domain per package name", () => {
		expect(
			threeWayMergeJson(
				{ dependencies: { react: "19.0.0" } },
				{},
				{ dependencies: { react: "19.1.0", vite: "7.0.0" } },
				{ preserveDependencyRemovals: true },
			),
		).toEqual({
			conflicts: [],
			merged: { dependencies: { vite: "7.0.0" } },
		});

		expect(
			threeWayMergeJson(
				{ dependencies: { react: "19.0.0" } },
				{ dependencies: { react: "19.0.0", local: "1.0.0" } },
				{},
				{ preserveDependencyRemovals: true },
			),
		).toEqual({
			conflicts: [],
			merged: { dependencies: { local: "1.0.0" } },
		});
	});

	it("keeps script removals conflict-aware", () => {
		expect(
			threeWayMergeJson(
				{ scripts: { dev: "vite" } },
				{ scripts: {} },
				{ scripts: { dev: "vite --host" } },
			),
		).toEqual({
			conflicts: [["scripts", "dev"]],
			merged: { scripts: { dev: "vite --host" } },
		});
	});

	it("merges a removed scripts domain per script name", () => {
		expect(
			threeWayMergeJson(
				{ scripts: { dev: "vite" } },
				{},
				{ scripts: { dev: "vite", test: "vitest" } },
			),
		).toEqual({
			conflicts: [],
			merged: { scripts: { test: "vitest" } },
		});

		expect(
			threeWayMergeJson(
				{ scripts: { dev: "vite" } },
				{},
				{ scripts: { dev: "vite --host" } },
			),
		).toEqual({
			conflicts: [["scripts", "dev"]],
			merged: { scripts: { dev: "vite --host" } },
		});
	});

	it("ignores json object key ordering as formatter drift", () => {
		expect(
			threeWayMergeJson(
				{ config: { alpha: true, beta: true } },
				{ config: { beta: true, alpha: true } },
				{ config: { alpha: true, beta: true, gamma: true } },
			),
		).toEqual({
			conflicts: [],
			merged: { config: { alpha: true, beta: true, gamma: true } },
		});
	});

	it("keeps only user json residue when forge removes a surface", () => {
		expect(
			jsonResidue(
				{
					plugins: ["forge"],
					settings: { forge: true, shared: "old" },
				},
				{
					plugins: ["forge", "user"],
					settings: { forge: true, shared: "user", user: true },
				},
			),
		).toEqual({
			plugins: ["user"],
			settings: { shared: "user", user: true },
		});
	});

	it("appends lines without duplicates and respects sections", () => {
		expect(
			appendLines(
				"# Env\nDATABASE_URL=\n",
				["DATABASE_URL=", "AUTH_SECRET="],
				"Env",
			),
		).toBe("# Env\nDATABASE_URL=\nAUTH_SECRET=\n");

		expect(appendLines("a\n", ["b", "a"])).toBe("a\nb\n");

		expect(appendLines("tail\n", ["head"], undefined, "start")).toBe(
			"head\ntail\n",
		);
	});

	it("creates missing sections and preserves existing ones", () => {
		expect(appendLines("", ["DATABASE_URL="], "Database")).toBe(
			"# Database\nDATABASE_URL=\n",
		);

		expect(
			appendLines(
				"# Env\nDATABASE_URL=\n\n# Auth\nAUTH_SECRET=\n",
				["RESEND_API_KEY="],
				"Email",
			),
		).toBe(
			"# Env\nDATABASE_URL=\n\n# Auth\nAUTH_SECRET=\n\n# Email\nRESEND_API_KEY=\n",
		);
	});

	it("three-way merges independent line insertions and reports concurrent inserts", () => {
		expect(threeWayMergeLines("a\nb\n", "a\nb\nc\n", "x\na\nb\n")).toEqual({
			conflicts: [],
			merged: "x\na\nb\nc\n",
		});

		expect(
			threeWayMergeLines("a\nb\n", "a\nlocal\nb\n", "a\nincoming\nb\n"),
		).toEqual({
			conflicts: ["concurrent insertion"],
			conflictValues: [
				{
					forge: "incoming",
					label: "concurrent insertion",
					user: "local",
				},
			],
			merged: "a\nincoming\nb\n",
		});
	});

	it("three-way merges separate line edits and reports same-segment conflicts", () => {
		expect(
			threeWayMergeLines(
				"a\nb\nc\nd\ne\nf\n",
				"a\nB\nc\nd\ne\nf\n",
				"a\nb\nc\nd\nE\nf\n",
			),
		).toEqual({
			conflicts: [],
			merged: "a\nB\nc\nd\nE\nf\n",
		});

		expect(
			threeWayMergeLines(
				"a\nb\nc\nd\ne\nf\n",
				"a\nB\nc\nd\ne\nf\n",
				"a\nX\nc\nd\ne\nf\n",
			),
		).toEqual({
			conflicts: ["b"],
			conflictValues: [{ base: "b", forge: "X", label: "b", user: "B" }],
			merged: "a\nX\nc\nd\ne\nf\n",
		});
	});

	it("merges independent additions within one section", () => {
		expect(
			threeWayMergeSections(
				"# Build\ndist/\n",
				"# Build\ndist/\n.cache/\n",
				"# Build\ndist/\ncoverage/\n",
			),
		).toEqual({
			conflicts: [],
			merged: "# Build\ndist/\n.cache/\ncoverage/\n",
		});
	});

	it("merges independent section deletion and addition entry-wise", () => {
		expect(
			threeWayMergeSections(
				"# Build\ndist/\n",
				"# Build\n",
				"# Build\ndist/\ncoverage/\n",
			),
		).toEqual({ conflicts: [], merged: "# Build\ncoverage/\n" });

		expect(
			threeWayMergeSections(
				"# Build\ndist/\n",
				"# Build\ndist/\nlocal/\n",
				"# Build\n",
			),
		).toEqual({ conflicts: [], merged: "# Build\nlocal/\n" });
	});

	it("preserves consecutive comment banners and header-only sections", () => {
		const banner = "# ===\n# Custom stuff";
		expect(parseSections(`${banner}\nmine/\n`)).toEqual([
			{ header: banner, lines: ["mine/"] },
		]);
		expect(
			threeWayMergeSections(
				"# Build\ndist/\n",
				"# Build\ndist/\n# ===\n# Custom stuff\nmine/\n",
				"# Build\ndist/\ncoverage/\n",
			),
		).toEqual({
			conflicts: [],
			merged: "# Build\ndist/\ncoverage/\n\n# ===\n# Custom stuff\nmine/\n",
		});
		expect(
			threeWayMergeSections(
				"# Empty\n# Banner line\n",
				"# Empty\n# Banner line\n",
				"# Empty\n# Banner line\n",
			),
		).toEqual({ conflicts: [], merged: "# Empty\n# Banner line\n" });
		expect(
			threeWayMergeSections(
				"# Empty\n# Next\nvalue\n",
				"# Empty\n# Next\nvalue\n",
				"# Empty\n# Next\nvalue\n",
			),
		).toEqual({ conflicts: [], merged: "# Empty\n# Next\nvalue\n" });
		expect(sectionResidue("", "# User header\n# Second line\n")).toBe(
			"# User header\n# Second line\n",
		);
	});

	it("normalizes section formatter drift before merging", () => {
		expect(
			threeWayMergeSections(
				"# Build\r\ndist/\r\n\r\n",
				"# Build\n\ndist/\n",
				"# Build\ndist/\ncoverage/\n",
			),
		).toEqual({
			conflicts: [],
			merged: "# Build\ndist/\ncoverage/\n",
		});
	});

	it("reports divergent edits to the same section entry", () => {
		expect(
			threeWayMergeSections(
				"# Build\ndist/\n",
				"# Build\nbuild/\n",
				"# Build\noutput/\n",
			),
		).toEqual({
			conflicts: ["Build -> dist/"],
			conflictValues: [
				{
					base: "dist/",
					forge: "output/",
					label: "Build -> dist/",
					user: "build/",
				},
			],
			merged: "# Build\noutput/\n",
		});
	});

	it("refuses a user reorder instead of silently restoring forge order", () => {
		const result = threeWayMergeSections(
			"# Build\na\nb\n",
			"# Build\nb\na\n",
			"# Build\na\nb\nc\n",
		);
		expect(result.conflicts).not.toEqual([]);
	});

	it("falls back without collapsing duplicate section headers", () => {
		const result = threeWayMergeSections(
			"# Build\na\n# Build\nb\n",
			"# Build\na\nlocal\n# Build\nb\n",
			"# Build\na\n# Build\nb\nincoming\n",
		);
		expect(result.merged).toContain("# Build\nb\nincoming\n");
		expect(result.merged.match(/# Build/g)).toHaveLength(2);
	});

	it("normalizes formatter drift before duplicate-header fallback", () => {
		expect(
			threeWayMergeSections(
				"# Build\r\na\r\n\r\n# Build\r\nb\r\n",
				"# Build\na\n\n# Build\nb\n",
				"# Build\na\n\n# Build\nb\nincoming\n",
			),
		).toEqual({
			conflicts: [],
			merged: "# Build\na\n\n# Build\nb\nincoming\n",
		});
	});

	it("preserves only user line residue when forge removes a surface", () => {
		expect(
			sectionResidue(
				"# Build\ndist/\n\n# Test\ncoverage/\n",
				"# Build\ndist/\n.cache/\n\n# Test\ncoverage/\n",
			),
		).toBe("# Build\n.cache/\n");
	});

	it("merges env examples by variable name", () => {
		expect(
			threeWayMergeEnv(
				"DATABASE_URL=old\nREMOVED=unchanged\nEDITED=old\n",
				"DATABASE_URL=user\nREMOVED=unchanged\nEDITED=user\nUSER_ONLY=value\n",
				"DATABASE_URL=forge\nADDED=new\n",
			),
		).toEqual({
			conflicts: [],
			merged: "DATABASE_URL=user\nADDED=new\nEDITED=user\nUSER_ONLY=value\n",
		});
	});

	it("removes obsolete env variables only when users left them unchanged", () => {
		expect(
			threeWayMergeEnv(
				"UNCHANGED=old\nEDITED=old\n",
				"UNCHANGED=old\nEDITED=user\n",
				"",
			),
		).toEqual({ conflicts: [], merged: "EDITED=user\n" });
	});

	it("uses new forge env values when users left the base untouched", () => {
		expect(
			threeWayMergeEnv("VALUE=old\n", "VALUE=old\n", "VALUE=new\n"),
		).toEqual({
			conflicts: [],
			merged: "VALUE=new\n",
		});
	});

	it("keeps only user env residue when forge removes a surface", () => {
		expect(envResidue("FORGE=old\n", "FORGE=user\nUSER=value\n")).toBe(
			"FORGE=user\nUSER=value\n",
		);
		expect(
			envResidue(
				"# Forge\nFORGE=old\n",
				"# Forge\nFORGE=old\n# User note\nUSER=value\n",
			),
		).toBe("# User note\nUSER=value\n");
		expect(envResidue("VALUE=old\n", "VALUE=old\n")).toBe("");
	});

	it("refuses ambiguous duplicate env variables", () => {
		expect(
			threeWayMergeEnv(
				"VALUE=old\n",
				"VALUE=user-one\nVALUE=user-two\n",
				"VALUE=forge\n",
			),
		).toEqual({
			conflicts: ["duplicate variable VALUE"],
			conflictValues: [
				{
					base: "VALUE=old",
					forge: "VALUE=forge",
					label: "duplicate variable VALUE",
					user: "VALUE=user-one\nVALUE=user-two",
				},
			],
			merged: "VALUE=forge\n",
		});
		expect(envResidue("VALUE=old\n", "VALUE=user-one\nVALUE=user-two\n")).toBe(
			"VALUE=user-one\nVALUE=user-two\n",
		);
	});

	it("resolves line and env conflicts without dropping clean changes", () => {
		const baseLines = "# Build\ndist/\n\n# Cache\n.cache/\n";
		const userLines = "# Build\nbuild/\n\n# Cache\n.local-cache/\n";
		const forgeLines =
			"# Build\noutput/\n\n# Cache\n.cache/\n\n# Test\ncoverage/\n";

		expect(
			threeWayMergeSections(baseLines, userLines, forgeLines, "user").merged,
		).toBe("# Build\nbuild/\n\n# Cache\n.local-cache/\n\n# Test\ncoverage/\n");
		expect(
			threeWayMergeSections(baseLines, userLines, forgeLines, "forge").merged,
		).toBe("# Build\noutput/\n\n# Cache\n.local-cache/\n\n# Test\ncoverage/\n");

		const baseEnv = "VALUE=old\nUNCHANGED=old\n";
		const userEnv =
			"VALUE=user-one\nVALUE=user-two\nUNCHANGED=old\nUSER_ONLY=value\n";
		const forgeEnv = "VALUE=forge\nUNCHANGED=new\nFORGE_ONLY=value\n";
		expect(threeWayMergeEnv(baseEnv, userEnv, forgeEnv, "user").merged).toBe(
			"VALUE=user-two\nUNCHANGED=new\nFORGE_ONLY=value\nUSER_ONLY=value\n",
		);
		expect(threeWayMergeEnv(baseEnv, userEnv, forgeEnv, "forge").merged).toBe(
			"VALUE=forge\nUNCHANGED=new\nFORGE_ONLY=value\nUSER_ONLY=value\n",
		);
	});

	it("resolves line and env conflicts with per-cell callbacks", () => {
		const lineResolutions = new Map<string, ConflictResolution>([
			["Build -> dist/", "user"],
			["Cache -> .cache/", "forge"],
		]);
		expect(
			threeWayMergeSections(
				"# Build\ndist/\n\n# Cache\n.cache/\n",
				"# Build\nbuild/\n\n# Cache\n.local-cache/\n",
				"# Build\noutput/\n\n# Cache\n.generated-cache/\n",
				undefined,
				(label) => lineResolutions.get(label),
			).merged,
		).toBe("# Build\nbuild/\n\n# Cache\n.generated-cache/\n");

		const envResolutions = new Map<string, ConflictResolution>([
			["duplicate variable FIRST", "user"],
			["duplicate variable SECOND", "forge"],
		]);
		expect(
			threeWayMergeEnv(
				"FIRST=old\nSECOND=old\n",
				"FIRST=user-one\nFIRST=user-two\nSECOND=user-one\nSECOND=user-two\n",
				"FIRST=forge-one\nFIRST=forge-two\nSECOND=forge-one\nSECOND=forge-two\n",
				undefined,
				(label) => envResolutions.get(label),
			).merged,
		).toBe("FIRST=user-two\nSECOND=forge-two\n");
	});

	it("numbers repeated line conflict labels for mixed resolutions", () => {
		const resolutions = new Map<string, ConflictResolution>([
			["Sec -> shared", "user"],
			["Sec -> shared (2nd)", "forge"],
		]);
		const result = threeWayMergeSections(
			"# Sec\nkeep\nshared\nmid\nshared\ntail\n",
			"# Sec\nkeep\nuser-one\nmid\nuser-two\ntail\n",
			"# Sec\nkeep\nforge-one\nmid\nforge-two\ntail\n",
			undefined,
			(label) => resolutions.get(label),
		);

		expect(result).toEqual({
			conflicts: ["Sec -> shared", "Sec -> shared (2nd)"],
			conflictValues: [
				{
					base: "shared",
					forge: "forge-one",
					label: "Sec -> shared",
					user: "user-one",
				},
				{
					base: "shared",
					forge: "forge-two",
					label: "Sec -> shared (2nd)",
					user: "user-two",
				},
			],
			merged: "# Sec\nkeep\nuser-one\nmid\nforge-two\ntail\n",
		});
	});

	it("keeps resolved env variables at their rendered positions", () => {
		const base = "BEFORE=old\nVALUE=old\nAFTER=old\n";
		const user =
			"BEFORE=old\nVALUE=user-one\nVALUE=user-two\nAFTER=old\nUSER_ONLY=value\n";
		const forge = "BEFORE=new\nVALUE=forge-one\nVALUE=forge-two\nAFTER=new\n";

		expect(threeWayMergeEnv(base, user, forge, "user").merged).toBe(
			"BEFORE=new\nVALUE=user-two\nAFTER=new\nUSER_ONLY=value\n",
		);
		expect(threeWayMergeEnv(base, user, forge, "forge").merged).toBe(
			"BEFORE=new\nVALUE=forge-two\nAFTER=new\nUSER_ONLY=value\n",
		);
	});

	it("honors selected-side env deletion with duplicate variables", () => {
		expect(
			threeWayMergeEnv(
				"VALUE=old\n",
				"VALUE=user-one\nVALUE=user-two\n",
				"",
				"forge",
			).merged,
		).toBe("");
		expect(
			threeWayMergeEnv(
				"VALUE=old\n",
				"",
				"VALUE=forge-one\nVALUE=forge-two\n",
				"user",
			).merged,
		).toBe("");
	});

	it("selects either side of a structurally ambiguous array conflict", () => {
		const base = { commands: ["base"] };
		const user = { commands: ["user", "custom"] };
		const forge = { commands: ["forge", "generated"] };

		expect(
			threeWayMergeJson(base, user, forge, { resolution: "user" }).merged,
		).toEqual(user);
		expect(
			threeWayMergeJson(base, user, forge, { resolution: "forge" }).merged,
		).toEqual(forge);
	});

	it("selects a conflicting array as one whole cell", () => {
		const base = { commands: ["a", "b"] };
		const user = { commands: ["u", "b"] };
		const forge = { commands: ["f", "x"] };

		expect(
			threeWayMergeJson(base, user, forge, { resolution: "user" }).merged,
		).toEqual(user);
		expect(
			threeWayMergeJson(base, user, forge, { resolution: "forge" }).merged,
		).toEqual(forge);
	});
});
