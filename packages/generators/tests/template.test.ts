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
const ROOT_DIR = join(TEMPLATE_DIR, "..", "..", "..");
const GITHUB_TEMPLATE_DIR = join(TEMPLATE_DIR, "tooling", "github");

const REPOSITORY_SETUP_ACTION = join(
	ROOT_DIR,
	"tooling",
	"github",
	"setup",
	"action.yml",
);

const readActionMajors = (path: string) => {
	const actions = new Map<string, string>();

	for (const match of readFileSync(path, "utf-8").matchAll(
		/^\s*- uses:\s+(?<depName>[\w.-]+\/[\w.-]+)@v(?<major>\d+)\s*$/gm,
	)) {
		const depName = match.groups?.depName;
		const major = match.groups?.major;

		if (depName && major) actions.set(depName, major);
	}

	return actions;
};

describe("interpolate", () => {
	it("replaces every occurrence of every placeholder", () => {
		expect(
			interpolate("__SLUG__/__SLUG__-__NAME__", { SLUG: "acme", NAME: "App" }),
		).toBe("acme/acme-App");
	});

	it("leaves unknown placeholders intact", () => {
		expect(interpolate("__UNKNOWN__", { SLUG: "acme" })).toBe("__UNKNOWN__");
	});

	it("replaces comment-position placeholders without leaving whitespace", () => {
		expect(
			interpolate("// __AUTH_IMPORT__\n{ /* __AUTH_ARG__ */ headers }\n", {
				"// __AUTH_IMPORT__\n": 'import { auth } from "@acme/auth";\n',
				"/* __AUTH_ARG__ */ ": "auth, ",
			}),
		).toBe('import { auth } from "@acme/auth";\n{ auth, headers }\n');
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

describe("GitHub Actions templates", () => {
	it("matches shared action majors with Forge's setup action", () => {
		const repositoryActions = readActionMajors(REPOSITORY_SETUP_ACTION);
		const sharedTemplateActions = new Map([
			["setup-action.pnpm.yml", ["pnpm/action-setup", "actions/setup-node"]],
			["setup-action.npm.yml", ["actions/setup-node"]],
			["setup-action.bun.yml", ["oven-sh/setup-bun", "actions/setup-node"]],
			["setup-action.yarn.yml", ["actions/setup-node"]],
		]);

		for (const [templateName, actionNames] of sharedTemplateActions) {
			const templateActions = readActionMajors(
				join(GITHUB_TEMPLATE_DIR, templateName),
			);

			for (const actionName of actionNames) {
				const repositoryMajor = repositoryActions.get(actionName);
				const templateMajor = templateActions.get(actionName);

				expect(repositoryMajor, `${actionName} is used by Forge`).toBeDefined();
				expect(
					templateMajor,
					`${templateName} uses ${actionName}`,
				).toBeDefined();
				expect(templateMajor, `${templateName} ${actionName}`).toBe(
					repositoryMajor,
				);
			}
		}
	});
});
