import { defineFramework } from "@ryuujs/core";
import { describe, expect, it } from "vitest";
import {
	frameworkBuildOutputs,
	frameworkIgnoreDirs,
	frameworksInPlay,
	frameworkTsconfigPresets,
} from "../src/registry/frameworks-in-play";

const web = defineFramework({
	buildOutputs: [".web/**", "shared/**"],
	configFile: "web.config.ts",
	id: "nextjs",
	ignoreDirs: [".web/", ".shared/"],
	name: "Web",
	sourceRoot: "",
	slots: [],
	tsconfigPreset: { content: {}, name: "web" },
});

const backend = defineFramework({
	buildOutputs: ["shared/**", ".backend/**"],
	configFile: "backend.config.ts",
	id: "backend",
	ignoreDirs: [".backend/", ".shared/"],
	name: "Backend",
	sourceRoot: "",
	slots: [],
	tsconfigPreset: { content: { backend: true }, name: "backend" },
});

const duplicatePreset = defineFramework({
	buildOutputs: [],
	configFile: "duplicate.config.ts",
	id: "duplicate",
	ignoreDirs: [],
	name: "Duplicate",
	sourceRoot: "",
	slots: [],
	tsconfigPreset: { content: { duplicate: true }, name: "web" },
});

const matchingPreset = defineFramework({
	buildOutputs: [],
	configFile: "matching.config.ts",
	id: "matching",
	ignoreDirs: [],
	name: "Matching",
	sourceRoot: "",
	slots: [],
	tsconfigPreset: { content: {}, name: "web" },
});

describe("frameworksInPlay", () => {
	it("selects the configured web framework", () => {
		expect(frameworksInPlay({ web: "nextjs" }, [web])).toEqual([web]);
	});

	it("does not select backend frameworks before backend machinery exists", () => {
		expect(frameworksInPlay({ backend: "hono" }, [web])).toEqual([]);
	});

	it("reports a missing configured framework from one shared location", () => {
		expect(() => frameworksInPlay({ web: "nextjs" }, [])).toThrow(
			"Framework Definition Missing: nextjs",
		);
	});

	it("builds an ordered, deduplicated union of framework outputs", () => {
		expect(frameworkBuildOutputs([web, backend])).toEqual([
			".web/**",
			"shared/**",
			".backend/**",
		]);
	});

	it("preserves framework order when collecting ignore directories", () => {
		expect(frameworkIgnoreDirs([web, backend])).toEqual([
			".web/",
			".shared/",
			".backend/",
			".shared/",
		]);
	});

	it("deduplicates matching presets with the same name", () => {
		expect(frameworkTsconfigPresets([web, backend, matchingPreset])).toEqual([
			web.tsconfigPreset,
			backend.tsconfigPreset,
		]);
	});

	it("rejects conflicting presets with the same name", () => {
		expect(() => frameworkTsconfigPresets([web, duplicatePreset])).toThrow(
			"TypeScript Preset Conflict: web is defined differently by nextjs and duplicate",
		);
	});
});
