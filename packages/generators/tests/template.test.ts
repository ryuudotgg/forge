import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { interpolate, readTemplate, templateFiles } from "../src/template";

const TEMPLATE_DIR = join(
	dirname(fileURLToPath(import.meta.url)),
	"..",
	"templates",
);

describe("interpolate", () => {
	it("replaces every occurrence of every placeholder", () => {
		expect(
			interpolate("__SLUG__/__SLUG__-__NAME__", { SLUG: "acme", NAME: "App" }),
		).toBe("acme/acme-App");
	});

	it("leaves unknown placeholders intact", () => {
		expect(interpolate("__UNKNOWN__", { SLUG: "acme" })).toBe("__UNKNOWN__");
	});
});

describe("readTemplate", () => {
	it("reads a template relative to the templates directory", () => {
		expect(readTemplate("shared/packages/shared/src/index.ts")).toBe(
			'export * from "./id";\nexport * from "./types";\n',
		);
	});

	it("throws when the template does not exist", () => {
		expect(() => readTemplate("does/not/exist.ts")).toThrow(/ENOENT/);
	});
});

describe("templateFiles", () => {
	it("emits one text file per template file, including nested directories", () => {
		const contributions = templateFiles("shared", "out");
		const files = contributions.flatMap((contribution) =>
			contribution._tag === "TextFileContribution" ? [contribution] : [],
		);

		expect(files).toHaveLength(contributions.length);
		expect(files.map((file) => file.path).sort()).toEqual([
			"out/packages/shared/src/id.ts",
			"out/packages/shared/src/index.ts",
			"out/packages/shared/src/types.ts",
		]);

		for (const file of files) {
			const source = join(
				TEMPLATE_DIR,
				"shared",
				file.path.slice("out/".length),
			);

			expect(file.content, file.path).toBe(readFileSync(source, "utf-8"));
		}
	});
});
