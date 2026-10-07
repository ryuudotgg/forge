import { describe, expect, it } from "vitest";
import { threeWayMergeYaml } from "../src/index";

describe("three way yaml merge", () => {
	it("adds a Forge group after the group it follows in Forge's render", () => {
		const base =
			"catalog:\n  # Build\n  tsdown: 0.1.0\n\n  # Lint\n  oxlint: 1.0.0\n";

		const current =
			"catalog:\n  # Build\n  tsdown: 0.1.0\n\n  # Lint\n  oxlint: 1.0.0\n\n  # Utilities\n  left-pad: 1.3.0\n";

		const incoming =
			"catalog:\n  # Build\n  tsdown: 0.1.0\n\n  # Testing\n  vitest: 3.1.0\n\n  # Lint\n  oxlint: 1.0.0\n";

		expect(threeWayMergeYaml(base, current, incoming)).toEqual({
			conflicts: [],
			merged:
				"catalog:\n  # Build\n  tsdown: 0.1.0\n\n  # Testing\n  vitest: 3.1.0\n\n  # Lint\n  oxlint: 1.0.0\n\n  # Utilities\n  left-pad: 1.3.0\n",
		});
	});

	it("drops a group Forge removed along with its header", () => {
		const base =
			"catalog:\n  # Build\n  tsdown: 0.1.0\n\n  # Testing\n  vitest: 3.0.0\n";

		const current = `${base}  # pinned for docs\n  left-pad: 1.3.0\n`;
		const incoming = "catalog:\n  # Build\n  tsdown: 0.1.0\n";

		expect(threeWayMergeYaml(base, current, incoming)?.merged).toBe(
			"catalog:\n  # Build\n  tsdown: 0.1.0\n\n  # pinned for docs\n  left-pad: 1.3.0\n",
		);
	});

	it("keeps user top level keys and comments while Forge adds a block", () => {
		const base = "packages:\n  - apps/*\n";
		const current =
			"# Workspace layout\npackages:\n  - apps/*\n\nnodeLinker: hoisted\n";

		const incoming = "packages:\n  - apps/*\n\noverrides:\n  vite: ^7.0.0\n";

		expect(threeWayMergeYaml(base, current, incoming)?.merged).toBe(
			"# Workspace layout\npackages:\n  - apps/*\n\noverrides:\n  vite: ^7.0.0\n\nnodeLinker: hoisted\n",
		);
	});

	it("treats quoted and bare keys and items as the same identity", () => {
		const base = 'packages:\n  - "apps/*"\ncatalog:\n  "@types/node": 22.0.0\n';
		const current =
			"packages:\n  - apps/*\ncatalog:\n  '@types/node': 22.0.0\n";

		const incoming =
			'packages:\n  - "apps/*"\ncatalog:\n  "@types/node": 24.0.0\n';

		expect(threeWayMergeYaml(base, current, incoming)?.merged).toBe(
			'packages:\n  - apps/*\ncatalog:\n  "@types/node": 24.0.0\n',
		);
	});

	it("reports a conflict per key with its values and honours resolutions", () => {
		const base = 'catalog:\n  "@types/node": 22.0.0\n  vite: 7.0.0\n';
		const current = 'catalog:\n  "@types/node": 22.1.0\n  vite: 7.0.1\n';
		const incoming = 'catalog:\n  "@types/node": 24.0.0\n  vite: 7.1.0\n';

		expect(threeWayMergeYaml(base, current, incoming)).toMatchObject({
			conflicts: ['catalog["@types/node"]', "catalog.vite"],
			conflictValues: [
				{
					base: "22.0.0",
					forge: "24.0.0",
					label: 'catalog["@types/node"]',
					user: "22.1.0",
				},
				{ base: "7.0.0", forge: "7.1.0", label: "catalog.vite", user: "7.0.1" },
			],
		});

		expect(
			threeWayMergeYaml(base, current, incoming, "forge", (label) =>
				label === "catalog.vite" ? "user" : undefined,
			)?.merged,
		).toBe('catalog:\n  "@types/node": 24.0.0\n  vite: 7.0.1\n');
	});

	it("conflicts when the user deletes an entry Forge changed", () => {
		const base = "catalog:\n  vite: 7.0.0\n  zod: 4.0.0\n";
		const current = "catalog:\n  zod: 4.0.0\n";
		const incoming = "catalog:\n  vite: 7.1.0\n  zod: 4.0.0\n";

		expect(threeWayMergeYaml(base, current, incoming)?.conflictValues).toEqual([
			{ base: "7.0.0", forge: "7.1.0", label: "catalog.vite" },
		]);

		expect(threeWayMergeYaml(base, current, incoming, "user")?.merged).toBe(
			current,
		);
	});

	it("compares a nested block as one value", () => {
		const base = "catalogs:\n  react18:\n    react: 18.0.0\n";
		const current = "catalogs:\n  react18:\n    react: 18.2.0\n";

		expect(threeWayMergeYaml(base, current, base)?.merged).toBe(current);
		expect(
			threeWayMergeYaml(
				base,
				current,
				"catalogs:\n  react18:\n    react: 18.3.0\n",
			)?.conflicts,
		).toEqual(["catalogs"]);
	});

	it("returns undefined for a document it cannot split into keyed blocks", () => {
		const base = "catalog:\n  vite: 7.0.0\n";

		expect(threeWayMergeYaml(base, "- vite\n", base)).toBeUndefined();
		expect(
			threeWayMergeYaml(base, "catalog:\n  vite: 7.0.0\ncatalog:\n", base),
		).toBeUndefined();
	});

	it("restores an entry the user deleted when Forge's side wins", () => {
		const base = "catalog:\n  vite: 7.0.0\n  zod: 4.0.0\n";
		const current = "catalog:\n  zod: 4.0.0\n";
		const incoming = "catalog:\n  vite: 7.1.0\n  zod: 4.0.0\n";

		expect(threeWayMergeYaml(base, current, incoming, "forge")?.merged).toBe(
			incoming,
		);

		expect(
			threeWayMergeYaml(
				"overrides:\n  vite: 7.0.0\n",
				"",
				"overrides:\n  vite: 7.1.0\n",
				"forge",
			)?.merged,
		).toBe("overrides:\n  vite: 7.1.0\n");
	});

	it("keeps a removed Forge header while a user entry still sits under it", () => {
		const base = "catalog:\n  # Utilities\n  dayjs: 1.0.0\n";
		const current =
			"catalog:\n  # Utilities\n  dayjs: 1.0.0\n  left-pad: 1.3.0\n";

		expect(threeWayMergeYaml(base, current, "catalog:\n")?.merged).toBe(
			"catalog:\n  # Utilities\n  left-pad: 1.3.0\n",
		);
	});

	it("keeps a column zero comment inside the block it introduces", () => {
		const base = "catalog:\n  vite: 7.0.0\n";
		const current =
			"catalog:\n  vite: 7.0.0\n\n# Utilities\n  left-pad: 1.3.0\n";

		expect(
			threeWayMergeYaml(
				base,
				current,
				"catalog:\n  vite: 7.1.0\n\noverrides:\n  vite: 7.1.0\n",
			)?.merged,
		).toBe(
			"catalog:\n  vite: 7.1.0\n\n# Utilities\n  left-pad: 1.3.0\n\noverrides:\n  vite: 7.1.0\n",
		);
	});

	it("ignores CRLF, requoting and trailing comments when comparing values", () => {
		const base = 'overrides:\n  vite: "^7.0.0"\n  zod: 4.0.0\n';
		const current =
			"overrides:\r\n  vite: ^7.0.0 # pinned\r\n  zod: '4.0.0'\r\n";

		const incoming = 'overrides:\n  vite: "^7.0.0"\n  zod: 4.1.0\n';

		expect(threeWayMergeYaml(base, current, incoming)).toEqual({
			conflicts: [],
			merged: "overrides:\n  vite: ^7.0.0 # pinned\n  zod: 4.1.0\n",
		});
	});

	it("keeps a user's inline comment when Forge bumps the value", () => {
		expect(
			threeWayMergeYaml(
				"catalog:\n  vite: 7.0.0\n",
				"catalog:\n  vite: 7.0.0 # required by docs\n",
				"catalog:\n  vite: 7.1.0\n",
			)?.merged,
		).toBe("catalog:\n  vite: 7.1.0 # required by docs\n");
	});

	it("treats a hash inside quotes as part of the value", () => {
		const base = 'packages:\n  - "apps/foo # first"\n';

		expect(
			threeWayMergeYaml(
				base,
				'packages:\n  - "apps/foo # second"\n',
				"packages:\n",
			)?.merged,
		).toBe('packages:\n  - "apps/foo # second"\n');
	});

	it("leaves the user's blank lines alone when nothing was removed", () => {
		const base = "packages:\n  - apps/*\n\ncatalog:\n  vite: 7.0.0\n";
		const current =
			"packages:\n  - apps/*\n\n\n\ncatalog:\n  vite: 7.0.0\n\n\n  left-pad: 1.3.0\n";

		expect(threeWayMergeYaml(base, current, base)?.merged).toBe(current);
	});

	it("adds no Forge header whose entries the merge does not insert", () => {
		const base = "catalog:\n  # Utilities\n  zod: 4.0.0\n\n  # Lint\n  b: 1\n";
		const current = `${base}  left-pad: 1.3.0\n`;
		const incoming =
			"catalog:\n  # Validation\n  zod: 4.0.0\n\n  # Linting\n  b: 1\n";

		expect(threeWayMergeYaml(base, current, incoming)?.merged).toBe(current);
	});

	it("puts a new Forge group after user entries appended to the group before", () => {
		const base = "catalog:\n  # Build\n  a: 1\n\n  # Lint\n  b: 1\n";
		const current =
			"catalog:\n  # Build\n  a: 1\n  mine: 1\n\n  # Lint\n  b: 1\n";

		const incoming =
			"catalog:\n  # Build\n  a: 1\n\n  # Testing\n  c: 1\n\n  # Lint\n  b: 1\n";

		expect(threeWayMergeYaml(base, current, incoming)?.merged).toBe(
			"catalog:\n  # Build\n  a: 1\n  mine: 1\n\n  # Testing\n  c: 1\n\n  # Lint\n  b: 1\n",
		);
	});

	it("adds Forge only entries without asking when no base was stored", () => {
		const result = threeWayMergeYaml(
			"",
			"catalog:\n  react: 19.0.0\n  left-pad: 1.3.0\n",
			"catalog:\n  # Framework\n  react: 19.1.0\n\n  # Testing\n  vitest: 5.0.0\n",
			"user",
			undefined,
			true,
		);

		expect(result?.conflicts).toEqual(["catalog.react", 'catalog["left-pad"]']);
		expect(result?.merged).toBe(
			"catalog:\n  react: 19.0.0\n  left-pad: 1.3.0\n\n  # Testing\n  vitest: 5.0.0\n",
		);
	});

	it("accepts sequence items at column zero under their key", () => {
		const base = 'packages:\n  - "apps/*"\n';

		expect(
			threeWayMergeYaml(
				base,
				"packages:\n- apps/*\n- docs/*\n",
				'packages:\n  - "apps/*"\n  - "tooling/*"\n',
			)?.merged,
		).toBe('packages:\n- apps/*\n- "tooling/*"\n- docs/*\n');
	});
});
