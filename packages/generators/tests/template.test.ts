import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	defineTemplateRecipe,
	inSourceRoot,
	marker,
	renderRecipeAsset,
	sharedAsset,
} from "@ryuugg/core";
import { describe, expect, it } from "vitest";
import {
	nextjsFramework,
	reactRouterFramework,
	tanstackStartFramework,
} from "../src/index";
import { interpolate, readTemplate } from "../src/template";

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

const REPOSITORY_CI_WORKFLOW = join(ROOT_DIR, ".github", "workflows", "ci.yml");

const readActionPins = (path: string) => {
	const actions = new Map<string, string>();
	for (const match of readFileSync(path, "utf-8").matchAll(
		/^\s*-? *uses:\s+(?<depName>[\w.-]+\/[\w.-]+)@(?<pin>\S+(?:\s+#\s+\S+)?)\s*$/gm,
	)) {
		const depName = match.groups?.depName;
		const pin = match.groups?.pin;
		if (depName && pin) actions.set(depName, pin);
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

	it("matches recipe rendering byte-for-byte", () => {
		const template =
			"// __AUTH_IMPORT__\nexport const __SLUG__ = call(/* __AUTH_ARG__ */ input);\n";

		const asset = sharedAsset("query-client", {
			template: "api/trpc/web/query-client.ts",
			destination: inSourceRoot("trpc/query-client.ts"),
		});

		const recipe = defineTemplateRecipe({
			addon: "trpc",
			markers: {
				SLUG: marker.required,
				AUTH_IMPORT: marker.toggleLine("// __AUTH_IMPORT__\n"),
				AUTH_ARG: marker.toggleInline("/* __AUTH_ARG__ */ "),
			},
			assets: [asset],
		});

		const legacyValues = {
			SLUG: "acme",
			"// __AUTH_IMPORT__\n": 'import { auth } from "@acme/auth";\n',
			"/* __AUTH_ARG__ */ ": "auth, ",
		};

		const rendered = renderRecipeAsset(recipe, asset, nextjsFramework, {
			markers: {
				SLUG: legacyValues.SLUG,
				AUTH_IMPORT: legacyValues["// __AUTH_IMPORT__\n"],
				AUTH_ARG: legacyValues["/* __AUTH_ARG__ */ "],
			},
			readTemplate: () => template,
			slots: {},
		});

		expect(rendered.content).toBe(interpolate(template, legacyValues));
	});
});

describe("framework source roots", () => {
	it("exposes the expected root for every web framework", () => {
		expect({
			nextjs: nextjsFramework.sourceRoot,
			"tanstack-start": tanstackStartFramework.sourceRoot,
			"react-router": reactRouterFramework.sourceRoot,
		}).toEqual({
			nextjs: "",
			"tanstack-start": "src",
			"react-router": "app",
		});
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

describe("GitHub Actions templates", () => {
	const templateNames = readdirSync(GITHUB_TEMPLATE_DIR).filter((name) =>
		name.endsWith(".yml"),
	);

	it("pins every action to a commit SHA with its release tag", () => {
		for (const templateName of templateNames) {
			const actions = readActionPins(join(GITHUB_TEMPLATE_DIR, templateName));

			for (const [actionName, pin] of actions) {
				expect(pin, `${templateName} ${actionName}`).toMatch(
					/^[0-9a-f]{40} # v\d+\.\d+\.\d+$/,
				);
			}
		}
	});

	it("matches the action pins Forge uses itself", () => {
		const repositoryActions = new Map([
			...readActionPins(REPOSITORY_CI_WORKFLOW),
			...readActionPins(REPOSITORY_SETUP_ACTION),
		]);

		const templateActions = new Map([
			["ci.yml", ["actions/checkout"]],
			["setup-action.pnpm.yml", ["pnpm/action-setup", "actions/setup-node"]],
			["setup-action.npm.yml", ["actions/setup-node"]],
			["setup-action.bun.yml", ["oven-sh/setup-bun", "actions/setup-node"]],
			["setup-action.yarn.yml", ["actions/setup-node"]],
		]);

		for (const [templateName, actionNames] of templateActions) {
			const actions = readActionPins(join(GITHUB_TEMPLATE_DIR, templateName));

			for (const actionName of actionNames) {
				const repositoryPin = repositoryActions.get(actionName);

				expect(repositoryPin, `${actionName} is used by Forge`).toBeDefined();
				expect(actions.get(actionName), `${templateName} ${actionName}`).toBe(
					repositoryPin,
				);
			}
		}
	});
});
