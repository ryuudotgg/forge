import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { repoRoot } from "../utils/harness";

const examplePath = join(repoRoot, "examples/registry-package");
async function exampleSources() {
	const entries = await readdir(examplePath);
	return Promise.all(
		entries.map((entry) => readFile(join(examplePath, entry), "utf-8")),
	);
}

describe("publishing guide", () => {
	it("copies every code block from the example registry package", async () => {
		const guide = await readFile(
			join(repoRoot, "contributing/PUBLISHING.md"),
			"utf-8",
		);

		const blocks = [...guide.matchAll(/```\w*\n([\s\S]*?)```/g)].map(
			(match) => match[1] ?? "",
		);

		const sources = await exampleSources();

		expect(blocks.length).toBeGreaterThan(0);

		for (const block of blocks)
			expect(
				sources.some((source) => source.includes(block)),
				block,
			).toBe(true);
	});

	it("covers the manifest, exports, errors and the update flow", async () => {
		const guide = await readFile(
			join(repoRoot, "contributing/PUBLISHING.md"),
			"utf-8",
		);

		const headings = [...guide.matchAll(/^## (.+)$/gm)].map(
			(match) => match[1],
		);

		expect(headings).toEqual([
			"Manifest",
			"Exports",
			"Errors",
			"Releasing an update",
		]);
	});
});
