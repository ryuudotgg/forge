import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { acceptedConfigKeys, assembleSchema } from "../src/config/schema";
import { steps } from "../src/steps";

describe("accepted config keys", () => {
	it("matches schema fields plus post-generation switches", () => {
		expect(acceptedConfigKeys(steps)).toEqual([
			...Object.keys(assembleSchema(steps).fields),
			"installDeps",
			"gitInit",
		]);
	});

	it("documents every accepted key in the README table", () => {
		const readme = readFileSync(
			new URL("../../../README.md", import.meta.url),
			"utf-8",
		);

		const section = readme.split("### Non-interactive\n")[1]?.split("\n## ")[0];
		const table = section?.split("| Key | Value |\n")[1]?.split("\n\n")[0];
		expect(table).toBeDefined();

		const keys = Array.from(
			table?.matchAll(/^\| `([^`]+)` \|/gm) ?? [],
			(match) => match[1],
		);

		expect(new Set(keys)).toEqual(new Set(acceptedConfigKeys(steps)));
		expect(keys).toHaveLength(acceptedConfigKeys(steps).length);
	});
});
