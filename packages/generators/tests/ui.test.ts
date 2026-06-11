import { type Contribution, ensuredModuleTarget } from "@ryuujs/core";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import type { ForgeConfig } from "../src";
import { loadAddonDefinition } from "../src";

const { addon } = loadAddonDefinition("ui");

function contributionsFor(config: ForgeConfig): ReadonlyArray<Contribution> {
	const result = addon.contribute({ config });
	if (result instanceof Promise || Effect.isEffect(result))
		throw new Error("Synchronous Contributions Expected: ui");
	return result;
}

function byTag<Tag extends Contribution["_tag"]>(tag: Tag) {
	return (
		contribution: Contribution,
	): contribution is Extract<Contribution, { _tag: Tag }> =>
		contribution._tag === tag;
}

function must<T>(value: T | undefined, label: string): T {
	if (value === undefined) throw new Error(`Missing Contribution: ${label}`);
	return value;
}

function leafFile(
	contributions: ReadonlyArray<Contribution>,
	moduleKey: string,
	path: string,
) {
	return must(
		contributions
			.filter(byTag("LeafTextFileContribution"))
			.find(
				(entry) =>
					entry.target._tag === "EnsuredModuleTarget" &&
					entry.target.moduleKey === moduleKey &&
					entry.path === path,
			),
		`${moduleKey}/${path}`,
	);
}

function packageJsonSurface(contributions: ReadonlyArray<Contribution>) {
	return must(
		contributions
			.filter(byTag("ManagedJsonSurfaceContribution"))
			.find((entry) => entry.surface === "packageJson"),
		"packageJson",
	);
}

function dependencyEntries(contributions: ReadonlyArray<Contribution>) {
	return must(
		contributions.find(byTag("ManagedDependenciesSurfaceContribution")),
		"packageJson dependencies",
	).dependencies;
}

const baseConfig: ForgeConfig = {
	slug: "acme",
	style: "tailwind",
	web: "nextjs",
};

describe("ui addon", () => {
	it("activates for any web framework", () => {
		expect(addon.when({ web: "nextjs" })).toBe(true);
		expect(addon.when({ web: "react-router" })).toBe(true);
		expect(addon.when({})).toBe(false);
	});

	it("emits the shadcn components.json for the ui package and the web app", () => {
		const contributions = contributionsFor(baseConfig);

		const uiComponents = leafFile(contributions, "ui", "components.json");
		expect(uiComponents.content.endsWith("\n")).toBe(true);

		const uiJson: unknown = JSON.parse(uiComponents.content);
		expect(uiJson).toMatchObject({
			$schema: "https://ui.shadcn.com/schema.json",
			style: "base-vega",
			tailwind: { css: "src/styles/globals.css", baseColor: "neutral" },
			aliases: {
				components: "@acme/ui/components",
				hooks: "@acme/ui/hooks",
				lib: "@acme/ui/lib",
				ui: "@acme/ui/components",
				utils: "@acme/ui/lib/utils",
			},
		});

		const appComponents = leafFile(contributions, "web", "components.json");
		const appJson: unknown = JSON.parse(appComponents.content);
		expect(appJson).toMatchObject({
			style: "base-vega",
			tailwind: { css: "../../packages/ui/src/styles/globals.css" },
			aliases: {
				components: "@/components",
				hooks: "@/hooks",
				lib: "@/lib",
				ui: "@acme/ui/components",
				utils: "@acme/ui/lib/utils",
			},
		});
	});

	it("flips to the radix style and drops the base-ui dependency", () => {
		const radix = contributionsFor({ ...baseConfig, uiLibrary: "radix" });

		const uiJson: unknown = JSON.parse(
			leafFile(radix, "ui", "components.json").content,
		);
		expect(uiJson).toMatchObject({ style: "radix-vega" });

		const appJson: unknown = JSON.parse(
			leafFile(radix, "web", "components.json").content,
		);
		expect(appJson).toMatchObject({ style: "radix-vega" });

		const radixNames = dependencyEntries(radix).map(({ name }) => name);
		expect(radixNames).not.toContain("@base-ui/react");

		const baseUiNames = dependencyEntries(contributionsFor(baseConfig)).map(
			({ name }) => name,
		);
		expect(baseUiNames).toContain("@base-ui/react");
	});

	it("gates the tailwind toolchain on the style selection", () => {
		const withTailwind = contributionsFor(baseConfig);
		expect(dependencyEntries(withTailwind)).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					name: "tailwindcss",
					type: "devDependencies",
				}),
				expect.objectContaining({
					name: "@tailwindcss/postcss",
					type: "devDependencies",
				}),
				expect.objectContaining({
					name: "tw-animate-css",
					type: "dependencies",
				}),
				expect.objectContaining({ name: "shadcn", type: "devDependencies" }),
			]),
		);

		const ensure = must(
			withTailwind.find(byTag("EnsureModuleContribution")),
			"ui module",
		);
		expect(ensure.moduleKey).toBe("ui");
		expect(ensure.root).toBe("packages/ui");
		expect(ensure.module).toMatchObject({
			capabilities: ["react", "ui", "tailwind"],
		});

		const withoutStyle = contributionsFor({ slug: "acme", web: "nextjs" });
		const names = dependencyEntries(withoutStyle).map(({ name }) => name);
		for (const name of [
			"tailwindcss",
			"@tailwindcss/postcss",
			"tw-animate-css",
			"shadcn",
		])
			expect(names).not.toContain(name);

		const cssEnsure = must(
			withoutStyle.find(byTag("EnsureModuleContribution")),
			"ui module",
		);
		expect(cssEnsure.module).toMatchObject({
			capabilities: ["react", "ui", "css"],
		});
	});

	it("re-exports the ui postcss config into the web app", () => {
		const postcss = leafFile(
			contributionsFor(baseConfig),
			"web",
			"postcss.config.mjs",
		);

		expect(postcss.target).toEqual(ensuredModuleTarget("web"));
		expect(postcss.content).toBe(
			'export { default } from "@acme/ui/postcss.config";\n',
		);
	});

	it("shapes the ui package exports and the shadcn add script per package manager", () => {
		const pnpm = packageJsonSurface(contributionsFor(baseConfig));

		expect(pnpm.target).toEqual(ensuredModuleTarget("ui"));
		expect(pnpm.value).toMatchObject({ name: "@acme/ui", private: true });
		expect(pnpm.value.exports).toEqual({
			"./globals.css": "./src/styles/globals.css",
			"./postcss.config": "./postcss.config.mjs",
			"./hooks/*": "./src/hooks/*.ts",
			"./lib/*": "./src/lib/*.ts",
			"./*": "./src/components/*.tsx",
		});
		expect(pnpm.value).toMatchObject({
			scripts: {
				typecheck: "tsgo --noEmit",
				"ui-add": "pnpm dlx shadcn@latest add",
			},
		});

		const npm = packageJsonSurface(
			contributionsFor({ ...baseConfig, packageManager: "npm" }),
		);
		expect(npm.value).toMatchObject({
			scripts: { "ui-add": "npx shadcn@latest add" },
		});
	});

	it("renders every leaf template with placeholders interpolated", () => {
		const contributions = contributionsFor(baseConfig);
		const leaves = contributions.filter(byTag("LeafTextFileContribution"));

		expect(leaves.map((leaf) => leaf.path)).toEqual(
			expect.arrayContaining([
				"src/lib/utils.ts",
				"src/styles/globals.css",
				"postcss.config.mjs",
				"src/components/button.tsx",
			]),
		);

		for (const leaf of leaves)
			expect(leaf.content, leaf.path).not.toMatch(/__[A-Z_]+__/);

		const utils = leafFile(contributions, "ui", "src/lib/utils.ts");
		expect(utils.content).toContain("export function cn(");
	});
});
