import { join } from "node:path";
import type { CatalogEntry } from "@ryuujs/generators";
import { listCatalogEntries } from "@ryuujs/generators";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadDiscoveryRegistry } from "../src/commands/lifecycle";
import {
	buildListEnvelope,
	buildListOutput,
	parseCatalogKind,
	runList,
	selectListEntries,
} from "../src/commands/list";
import {
	loadAdoptedDiscoveryFixture,
	loadDiscoveryFixture,
} from "./discovery-fixtures";
import { withTempDir, writeJson } from "./lifecycle-fixtures";

const catalog = listCatalogEntries();

const promptMocks = vi.hoisted(() => ({
	logMessage: vi.fn(),
	logWarn:
		vi.fn<
			(
				message: string,
				options: { readonly output: NodeJS.WriteStream },
			) => void
		>(),
}));

vi.mock("@clack/prompts", () => ({
	log: { message: promptMocks.logMessage, warn: promptMocks.logWarn },
}));

beforeEach(() => {
	promptMocks.logMessage.mockReset();
	promptMocks.logWarn.mockReset();
});

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
		expect(output).toContain(
			"React Router       react-router          Managed React Router app host.",
		);
		expect(output).toContain(
			"TanStack Router    tanstack-router       Managed TanStack Router single-page app host.",
		);
		expect(output).toContain(
			"Base               react-router/base     Base React Router template.",
		);
		expect(output).toContain("Auth.js");
		expect(output).toContain("authjs                [addon]");
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
				source: "first-party",
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
				frameworkSources: {},
				source: "first-party",
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
				source: "first-party",
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
		expect(parseCatalogKind("framework")).toBe("framework");
		expect(parseCatalogKind("template")).toBe("template");
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
		expect(JSON.parse(JSON.stringify(envelope))).toEqual(envelope);
		expect(
			envelope.entries.every((entry) => typeof entry.source === "string"),
		).toBe(true);
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
			      "source": "first-party",
			      "summary": "Add Drizzle ORM support.",
			      "targetMode": "single",
			    },
			  ],
			  "forgeListVersion": 1,
			}
		`);
	});

	it("skips the injected registry loader when first-party is set", async () => {
		const loader = vi.fn(() => Promise.reject(new Error("must not be called")));

		await runList("drizzle", { "first-party": true }, loader);

		expect(loader).not.toHaveBeenCalled();
		expect(promptMocks.logMessage).toHaveBeenCalledWith(
			buildListOutput(catalog, { query: "drizzle" }),
		);
	});

	it("renders an exact third-party row through an injected registry", async () => {
		const loaded = await loadDiscoveryFixture();

		await runList("sentry", {}, () => Promise.resolve(loaded));

		expect(promptMocks.logMessage).toHaveBeenCalledWith(
			[
				"Addons",
				"  Sentry  @acme/sentry  Add Sentry observability. [@acme/forge-sentry]",
				"",
				"1 entry. Run forge info <id> for details.",
				"",
			].join("\n"),
		);
	});

	it("renders exact first-party provenance for an adopted project", async () => {
		await withTempDir("list-adopted", async (directory) => {
			const loaded = await loadAdoptedDiscoveryFixture(directory);

			expect(loaded.descriptors).toEqual([]);

			await runList("drizzle", {}, () => Promise.resolve(loaded));

			expect(promptMocks.logMessage).toHaveBeenCalledWith(
				[
					"Addons",
					"  Drizzle  drizzle  Add Drizzle ORM support.",
					"",
					"1 entry. Run forge info <id> for details.",
					"",
				].join("\n"),
			);
		});
	});

	it("writes pure registry JSON with source on every entry", async () => {
		const loaded = await loadDiscoveryFixture();
		const envelope = buildListEnvelope(loaded.catalog, { query: "" });
		const consoleLog = vi.spyOn(console, "log").mockImplementation(() => {});

		try {
			await runList(undefined, { json: true }, () => Promise.resolve(loaded));

			expect(consoleLog).toHaveBeenCalledWith(
				JSON.stringify(envelope, null, "\t"),
			);
			expect(JSON.parse(JSON.stringify(envelope))).toEqual(envelope);
			expect(envelope.entries.every((entry) => entry.source.length > 0)).toBe(
				true,
			);
		} finally {
			consoleLog.mockRestore();
		}
	});

	it("keeps degraded discovery warnings out of JSON stdout", async () => {
		await withTempDir("list-json-registry-failure", async (directory) => {
			await writeJson(join(directory, ".forge/manifest.json"), {
				config: {},
				installs: [],
				modules: {},
				registries: ["@fixture/missing-registry"],
				schemaVersion: 1,
			});

			const stdout: string[] = [];
			const stderr: string[] = [];
			const consoleLog = vi
				.spyOn(console, "log")
				.mockImplementation((message: unknown) => {
					if (typeof message !== "string")
						throw new Error("Expected string JSON output");
					stdout.push(message);
				});
			promptMocks.logWarn.mockImplementation((message, options) => {
				expect(options.output).toBe(process.stderr);
				stderr.push(message);
			});

			try {
				await runList(undefined, { json: true }, () =>
					loadDiscoveryRegistry(directory),
				);
			} finally {
				consoleLog.mockRestore();
			}

			expect(stdout).toHaveLength(1);
			expect(JSON.parse(stdout[0] ?? "")).toEqual(
				buildListEnvelope(listCatalogEntries(), { query: "" }),
			);
			expect(stderr).toEqual([
				"We couldn't load this project's registries (Registry Not Installed: @fixture/missing-registry), so we're showing the first-party catalog.",
			]);
			expect(promptMocks.logWarn).toHaveBeenCalledTimes(1);
		});
	});

	it("writes exact filtered JSON command output", async () => {
		const consoleLog = vi.spyOn(console, "log").mockImplementation(() => {});
		try {
			await runList("drizzle", { json: true, kind: "addon" });

			expect(consoleLog).toHaveBeenCalledWith(
				JSON.stringify(
					buildListEnvelope(catalog, { kind: "addon", query: "drizzle" }),
					null,
					"\t",
				),
			);
			expect(promptMocks.logMessage).not.toHaveBeenCalled();
		} finally {
			consoleLog.mockRestore();
		}
	});

	it("defaults the query and writes exact empty human output", async () => {
		const consoleLog = vi.spyOn(console, "log").mockImplementation(() => {});
		try {
			await runList(undefined, { json: true, kind: "template" });

			expect(consoleLog).toHaveBeenCalledWith(
				JSON.stringify(
					buildListEnvelope(catalog, { kind: "template", query: "" }),
					null,
					"\t",
				),
			);
		} finally {
			consoleLog.mockRestore();
		}

		await runList("does-not-exist", {});

		expect(promptMocks.logMessage).toHaveBeenCalledWith(
			"0 entries. Run forge info <id> for details.\n",
		);
	});
});
