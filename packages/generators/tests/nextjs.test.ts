import { type Contribution, ensuredModuleTarget } from "@ryuujs/core";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import type { ForgeConfig } from "../src";
import { loadDefinitionRegistry } from "../src";

const template = (() => {
	const found = loadDefinitionRegistry().registry.templates.find(
		(entry) => entry.id === "nextjs/base",
	);
	if (!found) throw new Error("Template Not Found: nextjs/base");
	return found;
})();

function contributionsFor(config: ForgeConfig): ReadonlyArray<Contribution> {
	const result = template.contribute({ config });
	if (result instanceof Promise || Effect.isEffect(result))
		throw new Error("Synchronous Contributions Expected: nextjs/base");
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

function textSurface(
	contributions: ReadonlyArray<Contribution>,
	surface: string,
) {
	return must(
		contributions
			.filter(byTag("ManagedTextSurfaceContribution"))
			.find((entry) => entry.surface === surface),
		surface,
	);
}

function jsonSurface(
	contributions: ReadonlyArray<Contribution>,
	surface: string,
) {
	return must(
		contributions
			.filter(byTag("ManagedJsonSurfaceContribution"))
			.find((entry) => entry.surface === surface),
		surface,
	);
}

function leafFile(contributions: ReadonlyArray<Contribution>, path: string) {
	return must(
		contributions
			.filter(byTag("LeafTextFileContribution"))
			.find((entry) => entry.path === path),
		path,
	);
}

describe("nextjs/base template", () => {
	it("activates only for the nextjs web framework", () => {
		expect(template.when({ web: "nextjs" })).toBe(true);
		expect(template.when({ web: "react-router" })).toBe(false);
		expect(template.when({})).toBe(false);
	});

	it("transpiles the workspace packages behind the selected addons", () => {
		const full = contributionsFor({
			authentication: "better-auth",
			orm: "drizzle",
			rpc: "trpc",
			slug: "acme",
			web: "nextjs",
		});
		expect(textSurface(full, "frameworkConfig").content).toContain(
			'transpilePackages: ["@acme/auth", "@acme/db", "@acme/trpc", "@acme/ui"],',
		);

		const ormOnly = contributionsFor({
			orm: "prisma",
			slug: "acme",
			web: "nextjs",
		});
		expect(textSurface(ormOnly, "frameworkConfig").content).toContain(
			'transpilePackages: ["@acme/db", "@acme/ui"],',
		);

		const bare = contributionsFor({ slug: "acme", web: "nextjs" });
		expect(textSurface(bare, "frameworkConfig").content).toContain(
			'transpilePackages: ["@acme/ui"],',
		);
	});

	it("renders providers with the trpc wrapper only when trpc is selected", () => {
		const bare = leafFile(
			contributionsFor({ slug: "acme", web: "nextjs" }),
			"app/providers.tsx",
		);
		expect(bare.target).toEqual(ensuredModuleTarget("web"));
		expect(bare.content).toContain("{children}");
		expect(bare.content).not.toContain("TRPCReactProvider");
		expect(bare.content).not.toContain("@/trpc/react");

		const withTrpc = leafFile(
			contributionsFor({ rpc: "trpc", slug: "acme", web: "nextjs" }),
			"app/providers.tsx",
		);
		expect(withTrpc.content).toContain(
			'import { TRPCReactProvider } from "@/trpc/react";',
		);
		expect(withTrpc.content).toContain(
			"<TRPCReactProvider>{children}</TRPCReactProvider>",
		);
	});

	it("wires the app scripts through the package manager", () => {
		const pnpm = must(
			contributionsFor({ slug: "acme", web: "nextjs" })
				.filter(byTag("ManagedScriptsSurfaceContribution"))
				.find((entry) => entry.surface === "packageJson"),
			"packageJson scripts",
		);

		expect(pnpm.target).toEqual(ensuredModuleTarget("web"));
		expect(pnpm.scripts).toEqual({
			build: "pnpm with-env next build",
			dev: "pnpm with-env next dev",
			postinstall: "pnpm typegen",
			pretypecheck: "pnpm with-env next typegen",
			start: "pnpm with-env next start",
			typecheck: "tsc --noEmit",
			typegen: "pnpm with-env next typegen",
			"with-env": "dotenv -e ../../.env --",
		});

		const npm = must(
			contributionsFor({ packageManager: "npm", slug: "acme", web: "nextjs" })
				.filter(byTag("ManagedScriptsSurfaceContribution"))
				.find((entry) => entry.surface === "packageJson"),
			"packageJson scripts",
		);

		expect(npm.scripts).toMatchObject({
			build: "npm run with-env -- next build",
			postinstall: "npm run typegen",
			pretypecheck: "npm run with-env -- next typegen",
			typegen: "npm run with-env -- next typegen",
		});
	});

	it("surfaces layout and page at priority 0 with the project name", () => {
		const contributions = contributionsFor({
			name: "Acme App",
			slug: "acme",
			web: "nextjs",
		});

		const layout = textSurface(contributions, "layout");
		expect(layout.target).toEqual(ensuredModuleTarget("web"));
		expect(layout.priority).toBe(0);
		expect(layout.content).toContain('title: "Acme App",');
		expect(layout.content).toContain('import "@acme/ui/globals.css";');

		const page = textSurface(contributions, "page");
		expect(page.target).toEqual(ensuredModuleTarget("web"));
		expect(page.priority).toBe(0);
		expect(page.content).toContain(">Acme App</h1>");

		const ensure = must(
			contributions.find(byTag("EnsureModuleContribution")),
			"web module",
		);
		expect(ensure.moduleKey).toBe("web");
		expect(ensure.root).toBe("apps/web");
	});

	it("maps the ui tsconfig path and names the web package", () => {
		const contributions = contributionsFor({ slug: "acme", web: "nextjs" });

		expect(jsonSurface(contributions, "tsconfig").value).toMatchObject({
			extends: "@acme/tsconfig/nextjs.json",
			compilerOptions: {
				paths: {
					"@/*": ["./*"],
					"@acme/ui/*": ["../../packages/ui/src/*"],
				},
			},
		});

		expect(jsonSurface(contributions, "packageJson").value).toMatchObject({
			name: "@acme/web",
			private: true,
		});

		const dependencies = must(
			contributions.find(byTag("ManagedDependenciesSurfaceContribution")),
			"packageJson dependencies",
		);
		expect(dependencies.dependencies).toEqual(
			expect.arrayContaining([
				{ name: "@acme/ui", version: "workspace:*", type: "dependencies" },
				{
					name: "@acme/tsconfig",
					version: "workspace:*",
					type: "devDependencies",
				},
			]),
		);
	});

	it("falls back to the my-app slug", () => {
		const contributions = contributionsFor({ web: "nextjs" });

		expect(textSurface(contributions, "frameworkConfig").content).toContain(
			'transpilePackages: ["@my-app/ui"],',
		);
		expect(jsonSurface(contributions, "packageJson").value).toMatchObject({
			name: "@my-app/web",
		});
		expect(textSurface(contributions, "layout").content).toContain(
			'title: "my-app",',
		);
	});
});
