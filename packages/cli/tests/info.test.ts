import type { CatalogEntry } from "@ryuujs/generators";
import { getCatalogEntry, listCatalogEntries } from "@ryuujs/generators";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	buildInfoEnvelope,
	buildInfoNotFoundMessage,
	buildInfoOutput,
	runInfo,
} from "../src/commands/info";
import {
	loadAdoptedDiscoveryFixture,
	loadDiscoveryFixture,
} from "./discovery-fixtures";
import { withTempDir } from "./lifecycle-fixtures";

const promptMocks = vi.hoisted(() => ({
	logError: vi.fn(),
	logMessage: vi.fn(),
}));

vi.mock("@clack/prompts", () => ({
	log: {
		error: promptMocks.logError,
		message: promptMocks.logMessage,
	},
}));

function requireEntry(id: string) {
	const entry = getCatalogEntry(id);
	if (entry === undefined) throw new Error(`Missing test catalog entry: ${id}`);
	return entry;
}

beforeEach(() => {
	promptMocks.logError.mockReset();
	promptMocks.logMessage.mockReset();
});

describe("forge info builders", () => {
	it("renders addon, framework, and template rows", () => {
		const addon = buildInfoOutput(requireEntry("trpc"), []);
		const framework = buildInfoOutput(requireEntry("nextjs"), []);
		const template = buildInfoOutput(requireEntry("nextjs/base"), []);

		expect(addon).toContain("Category:        addon");
		expect(addon).toContain("Targets:         Single target");
		expect(addon).toContain(
			"Frameworks:      nextjs, react-router, tanstack-start, hono, fastify, and express",
		);
		expect(addon).toContain("Required slots:  trpc");
		expect(framework).toContain("Slots:");
		expect(template).toContain("Framework:  nextjs");
		expect(template).toContain("Version:    1");
	});

	it("renders the exact addon card", () => {
		expect(buildInfoOutput(requireEntry("trpc"), [])).toBe(
			[
				"tRPC trpc",
				"Add tRPC to an app target.",
				"Adds tRPC server and client surfaces to compatible Forge application targets.",
				[
					"Publisher:       Ryuu (first party)",
					"Category:        addon",
					"Targets:         Single target",
					"Frameworks:      nextjs, react-router, tanstack-start, hono, fastify, and express",
					"Required slots:  trpc",
					"Keywords:        api, rpc, trpc, and typescript",
					"",
				].join("\n"),
			].join("\n\n"),
		);
	});

	it("renders capabilities and multiple targets", () => {
		const entry: CatalogEntry = {
			available: true,
			capabilities: ["alpha", "beta"],
			category: "tooling",
			description: "One summary.",
			experimental: false,
			frameworkSources: {},
			hidden: false,
			id: "custom",
			keywords: [],
			kind: "addon",
			name: "Custom Addon",
			source: "first-party",
			summary: "One summary.",
			targetMode: "multiple",
		};

		expect(buildInfoOutput(entry, [])).toBe(
			[
				"Custom Addon custom",
				"One summary.",
				[
					"Publisher:     Ryuu (first party)",
					"Category:      tooling",
					"Targets:       Multiple targets",
					"Capabilities:  alpha and beta",
					"",
				].join("\n"),
			].join("\n\n"),
		);
	});

	it("renders the exact announced-entry card", () => {
		expect(buildInfoOutput(requireEntry("authjs"), [])).toBe(
			`${[
				"Auth.js authjs",
				[
					"Publisher:     Ryuu (first party)",
					"Availability:  Auth.js isn't available yet.",
				].join("\n"),
			].join("\n\n")}\n`,
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
		expect(
			buildInfoEnvelope(requireEntry("drizzle"), []),
		).toMatchInlineSnapshot(`
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
			    "source": "first-party",
			    "summary": "Add Drizzle ORM support.",
			    "targetMode": "single",
			  },
			  "forgeListVersion": 1,
			}
		`);
	});

	it("skips the injected registry loader when first-party is set", async () => {
		const loader = vi.fn(() => Promise.reject(new Error("must not be called")));

		await runInfo("drizzle", { "first-party": true }, loader);

		expect(loader).not.toHaveBeenCalled();
		expect(promptMocks.logMessage).toHaveBeenCalledWith(
			buildInfoOutput(requireEntry("drizzle"), []),
		);
	});

	it("renders publisher provenance through an injected registry", async () => {
		const loaded = await loadDiscoveryFixture();

		await runInfo("@acme/sentry", {}, () => Promise.resolve(loaded));
		expect(promptMocks.logMessage).toHaveBeenLastCalledWith(
			[
				"Sentry @acme/sentry",
				"Add Sentry observability.",
				"Adds Sentry observability to compatible Forge application targets.",
				[
					"Publisher:   @acme/forge-sentry 1.4.2",
					"Category:    tooling",
					"Targets:     Multiple targets",
					"Frameworks:  nextjs and @solid/web (via @solid/forge-sentry)",
					"Keywords:    errors, monitoring, and sentry",
					"",
				].join("\n"),
			].join("\n\n"),
		);

		await runInfo("vitest", {}, () => Promise.resolve(loaded));
		expect(promptMocks.logMessage).toHaveBeenLastCalledWith(
			[
				"Vitest vitest",
				"Test the generated web app with Vitest.",
				"Vitest setup for fast, framework-agnostic tests in the generated web app.",
				[
					"Publisher:   Ryuu (first party)",
					"Category:    tooling",
					"Targets:     Single target",
					"Frameworks:  tanstack-start (via @acme/forge-sentry)",
					"Keywords:    test, testing, tooling, and vitest",
					"",
				].join("\n"),
			].join("\n\n"),
		);
	});

	it("renders the exact catalog card for an adopted project", async () => {
		await withTempDir("info-adopted", async (directory) => {
			const loaded = await loadAdoptedDiscoveryFixture(directory);

			expect(loaded.descriptors).toEqual([]);

			await runInfo("drizzle", {}, () => Promise.resolve(loaded));

			expect(promptMocks.logMessage).toHaveBeenCalledWith(
				[
					"Drizzle drizzle",
					"Add Drizzle ORM support.",
					"Adds Drizzle ORM configuration, schema surfaces, and database tooling to a compatible app.",
					[
						"Publisher:  Ryuu (first party)",
						"Category:   orm",
						"Targets:    Single target",
						"Keywords:   database, drizzle, orm, and sql",
						"",
					].join("\n"),
				].join("\n\n"),
			);
		});
	});

	it("adds publisherVersion only to third-party info JSON", async () => {
		const loaded = await loadDiscoveryFixture();
		const sentry = loaded.catalog.find((entry) => entry.id === "@acme/sentry");
		const vitest = loaded.catalog.find((entry) => entry.id === "vitest");
		if (sentry === undefined || vitest === undefined)
			throw new Error("Missing discovery fixture entries");

		const thirdParty = buildInfoEnvelope(sentry, loaded.descriptors);
		const firstParty = buildInfoEnvelope(vitest, loaded.descriptors);
		expect(thirdParty.entry).toMatchObject({
			capabilities: [],
			frameworks: ["nextjs", "@solid/web"],
			publisherVersion: "1.4.2",
			requiredSlots: [],
			source: "@acme/forge-sentry",
		});
		expect(firstParty.entry).not.toHaveProperty("publisherVersion");
		expect(firstParty.entry.source).toBe("first-party");
		expect(JSON.parse(JSON.stringify(thirdParty))).toEqual(thirdParty);

		const consoleLog = vi.spyOn(console, "log").mockImplementation(() => {});
		try {
			await runInfo("@acme/sentry", { json: true }, () =>
				Promise.resolve(loaded),
			);
			expect(consoleLog).toHaveBeenCalledWith(
				JSON.stringify(thirdParty, null, "\t"),
			);
		} finally {
			consoleLog.mockRestore();
		}
	});

	it("rejects a third-party entry without its publisher descriptor", async () => {
		const loaded = await loadDiscoveryFixture();
		const sentry = loaded.catalog.find((entry) => entry.id === "@acme/sentry");
		if (sentry === undefined)
			throw new Error("Missing discovery fixture entry");

		expect(() => buildInfoEnvelope(sentry, [])).toThrow(
			"Catalog Publisher Missing: @acme/forge-sentry",
		);
	});

	it("writes exact human and JSON command output", async () => {
		await runInfo("nextjs/base", {});

		expect(promptMocks.logMessage).toHaveBeenCalledWith(
			[
				"Base nextjs/base",
				"Base Next.js template.",
				"A production-ready Next.js base template that composes cleanly with Forge addons.",
				[
					"Publisher:  Ryuu (first party)",
					"Framework:  nextjs",
					"Version:    1",
					"Keywords:   base, next, starter, template, and web",
					"",
				].join("\n"),
			].join("\n\n"),
		);

		const consoleLog = vi.spyOn(console, "log").mockImplementation(() => {});
		try {
			await runInfo("drizzle", { json: true });

			expect(consoleLog).toHaveBeenCalledWith(
				JSON.stringify(
					buildInfoEnvelope(requireEntry("drizzle"), []),
					null,
					"\t",
				),
			);
			expect(promptMocks.logMessage).toHaveBeenCalledTimes(1);
		} finally {
			consoleLog.mockRestore();
		}
	});

	it("reports missing and hidden ids as exact command errors", async () => {
		const exit = vi.spyOn(process, "exit").mockImplementation((code) => {
			throw new Error(`exit:${code ?? 0}`);
		});

		try {
			await expect(runInfo("missing", {})).rejects.toThrow("exit:1");
			await expect(runInfo("root", {})).rejects.toThrow("exit:1");

			expect(promptMocks.logError).toHaveBeenNthCalledWith(
				1,
				'We couldn\'t find "missing" in the catalog.',
			);
			expect(promptMocks.logError).toHaveBeenNthCalledWith(
				2,
				'We couldn\'t find "root" in the catalog.',
			);
		} finally {
			exit.mockRestore();
		}
	});
});
