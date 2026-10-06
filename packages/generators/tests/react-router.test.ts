import { type Contribution, ensuredModuleTarget } from "@ryuugg/core";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import type { ForgeConfig } from "../src";
import { loadDefinitionRegistry } from "../src";
import { reactRouterFramework } from "../src/frameworks/react-router";
import { versions } from "../src/versions";
import { plannedProject } from "./planner-harness";

const template = (() => {
	const found = loadDefinitionRegistry().registry.templates.find(
		(entry) => entry.id === "react-router/base",
	);

	if (!found) throw new Error("Template Not Found: react-router/base");
	return found;
})();

function contributionsFor(config: ForgeConfig): ReadonlyArray<Contribution> {
	const result = template.contribute({
		commandVersions: {},
		config,
		frameworks: [reactRouterFramework],
	});

	if (result instanceof Promise || Effect.isEffect(result))
		throw new Error("Synchronous Contributions Expected: react-router/base");

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

describe("react-router/base template", () => {
	it("activates only for the react-router web framework", () => {
		expect(template.when({ web: "react-router" })).toBe(true);
		expect(template.when({ web: "nextjs" })).toBe(false);
		expect(template.when({ web: "tanstack-start" })).toBe(false);
		expect(template.when({})).toBe(false);
	});

	it("declares the verified framework contract and slot map", () => {
		expect(reactRouterFramework).toMatchObject({
			buildOutputs: ["build/**"],
			configFile: "react-router.config.ts",
			ignoreDirs: [".react-router/"],
			slots: ["layout", "page", "api", "trpc", "auth", "orpc"],
			tsconfigPreset: {
				name: "react-router",
				content: {
					compilerOptions: {
						declaration: false,
						declarationMap: false,
						lib: ["DOM", "DOM.Iterable", "ES2022"],
						target: "ES2022",
					},
				},
			},
		});

		expect(
			reactRouterFramework.tsconfigPreset.content.compilerOptions,
		).not.toHaveProperty("rootDirs");

		const contributions = contributionsFor({
			name: "Acme App",
			slug: "acme",
			web: "react-router",
		});

		const ensure = must(
			contributions.find(byTag("EnsureModuleContribution")),
			"web module",
		);

		expect(ensure.moduleKey).toBe("web");
		expect(ensure.root).toBe("apps/web");
		expect(ensure.module.template).toEqual({
			id: "react-router/base",
			version: 1,
		});

		expect(ensure.module.slots).toEqual({
			layout: "app/root.tsx",
			page: "app/routes/home.tsx",
			api: "app/routes/api",
			trpc: "app/routes/api.trpc.$.ts",
			auth: "app/routes/api.auth.$.ts",
		});
	});

	it("renders the config surface and scaffold leaf files", () => {
		const contributions = contributionsFor({
			name: "Acme App",
			slug: "acme",
			web: "react-router",
		});

		expect(textSurface(contributions, "frameworkConfig").content).toBe(
			`import type { Config } from "@react-router/dev/config";

export default {
  ssr: true,
} satisfies Config;
`,
		);

		expect(textSurface(contributions, "layout").content).toContain(
			'import type { Route } from "./+types/root";',
		);

		expect(textSurface(contributions, "page").content).toContain(
			">Acme App</h1>",
		);

		expect(leafFile(contributions, "env.ts").content).toContain(
			'return lifecycleEvent === "check" || lifecycleEvent === "typegen";',
		);

		expect(leafFile(contributions, "public/favicon.svg").content).toContain(
			"<title>App icon</title>",
		);
	});

	it("renders exact Vite configs with Tailwind cleanly switched on and off", () => {
		const withoutTailwind = leafFile(
			contributionsFor({ slug: "acme", web: "react-router" }),
			"vite.config.ts",
		);

		expect(withoutTailwind.content).toBe(`import "./env";

import { reactRouter } from "@react-router/dev/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [reactRouter()],
  resolve: { tsconfigPaths: true },
});
`);

		const withTailwind = leafFile(
			contributionsFor({
				slug: "acme",
				style: "tailwind",
				web: "react-router",
			}),
			"vite.config.ts",
		);

		expect(withTailwind.content).toBe(`import "./env";

import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [tailwindcss(), reactRouter()],
  resolve: { tsconfigPaths: true },
});
`);
	});

	it("renders route registration markers byte-cleanly in every toggle state", () => {
		const routeContent = (config: ForgeConfig) =>
			leafFile(contributionsFor(config), "app/routes.ts").content;

		expect(routeContent({ web: "react-router" })).toBe(
			`import { index, type RouteConfig } from "@react-router/dev/routes";

export default [index("routes/home.tsx")] satisfies RouteConfig;
`,
		);

		expect(routeContent({ rpc: "trpc", web: "react-router" })).toContain(
			'  route("api/trpc/*", "routes/api.trpc.$.ts"),',
		);

		expect(
			routeContent({ authentication: "better-auth", web: "react-router" }),
		).toContain('  route("api/auth/*", "routes/api.auth.$.ts"),');

		const both = routeContent({
			authentication: "better-auth",
			rpc: "trpc",
			web: "react-router",
		});

		expect(both).toBe(
			`import { index, type RouteConfig, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("api/trpc/*", "routes/api.trpc.$.ts"),
  route("api/auth/*", "routes/api.auth.$.ts"),
] satisfies RouteConfig;
`,
		);

		expect(both.indexOf('route("api/trpc/*"')).toBeLessThan(
			both.indexOf('route("api/auth/*"'),
		);

		for (const content of [
			routeContent({ web: "react-router" }),
			routeContent({ rpc: "trpc", web: "react-router" }),
			routeContent({ authentication: "better-auth", web: "react-router" }),
			both,
		])
			expect(content).not.toMatch(/__[A-Z_]+__/);
	});

	it("mounts the tRPC provider only when tRPC is selected", () => {
		const bare = leafFile(
			contributionsFor({ slug: "acme", web: "react-router" }),
			"app/providers.tsx",
		);

		expect(bare.target).toEqual(ensuredModuleTarget("web"));
		expect(bare.content).not.toContain("trpc:");
		expect(bare.content).not.toContain("TRPCReactProvider");

		const withTrpc = leafFile(
			contributionsFor({ rpc: "trpc", slug: "acme", web: "react-router" }),
			"app/providers.tsx",
		);

		expect(withTrpc.content).toContain(
			'import { TRPCReactProvider } from "@/trpc/react";',
		);

		expect(withTrpc.content).toContain("trpc: TRPCReactProvider,");
		expect(withTrpc.content).not.toMatch(/__[A-Z_]+__/);
	});

	it("uses the verified package versions, scripts, and app tsconfig", () => {
		const contributions = contributionsFor({
			slug: "acme",
			web: "react-router",
		});

		const dependencySurface = must(
			contributions.find(byTag("ManagedDependenciesSurfaceContribution")),
			"packageJson dependencies",
		);

		const dependencyVersions = new Map(
			dependencySurface.dependencies.map((entry) => [
				entry.name,
				entry.version,
			]),
		);

		const versionKeys: ReadonlyArray<
			| "reactRouter"
			| "reactRouterDev"
			| "reactRouterNode"
			| "reactRouterServe"
			| "isbot"
		> = [
			"reactRouter",
			"reactRouterDev",
			"reactRouterNode",
			"reactRouterServe",
			"isbot",
		];

		for (const key of versionKeys)
			expect(dependencyVersions.get(versions[key].name)).toBe(
				versions[key].version,
			);

		const scripts = must(
			contributions.find(byTag("ManagedScriptsSurfaceContribution")),
			"packageJson scripts",
		);

		expect(scripts.scripts).toEqual({
			build: "pnpm with-env react-router build",
			dev: "pnpm with-env react-router dev",
			postinstall: "pnpm typegen || exit 0",
			pretypecheck: "pnpm with-env react-router typegen",
			start:
				"dotenv -e .env.production -e ../../.env -v NODE_ENV=production -- react-router-serve ./build/server/index.js",
			typecheck: "tsc --noEmit",
			typegen: "pnpm with-env react-router typegen",
			"with-env": "dotenv -e ../../.env --",
		});

		expect(jsonSurface(contributions, "tsconfig").value).toEqual({
			extends: "@acme/tsconfig/react-router.json",
			compilerOptions: {
				paths: {
					"@/*": ["./app/*"],
					"@acme/ui/*": ["../../packages/ui/src/*"],
				},
				rootDirs: [".", "./.react-router/types"],
			},
			include: [
				"**/*",
				"**/.server/**/*",
				"**/.client/**/*",
				".react-router/types/**/*",
			],
		});
	});
});

describe("react-router API routes", () => {
	const bareRoutes = `import { index, type RouteConfig } from "@react-router/dev/routes";

export default [index("routes/home.tsx")] satisfies RouteConfig;
`;

	it.each([
		{ backend: "hono", rpc: "trpc" },
		{ backend: "hono", rpc: undefined },
		{ backend: "express", rpc: "trpc" },
		{ backend: "fastify", rpc: undefined },
	] as const)(
		"lists no API routes beside a $backend server with rpc $rpc",
		async ({ backend, rpc }) => {
			const plan = await plannedProject({
				slug: "acme",
				web: "react-router",
				backend,
				...(rpc === undefined ? {} : { rpc }),
				authentication: "better-auth",
				orm: "drizzle",
				database: "sqlite",
			});

			expect(
				plan.writes.find((write) => write.path === "apps/web/app/routes.ts")
					?.content,
			).toBe(bareRoutes);

			expect(
				plan.writes
					.map((write) => write.path)
					.filter((path) => path.startsWith("apps/web/app/routes/api.")),
			).toEqual([]);
		},
	);

	it("lists only the invitation page beside a Hono server with organizations", async () => {
		const plan = await plannedProject({
			slug: "acme",
			web: "react-router",
			backend: "hono",
			authentication: "better-auth",
			authMethods: ["email-password"],
			authPlugins: ["organization"],
			orm: "drizzle",
			database: "sqlite",
		});

		expect(
			plan.writes.find((write) => write.path === "apps/web/app/routes.ts")
				?.content,
		).toBe(`import { index, type RouteConfig, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("accept-invitation/:id", "routes/accept-invitation.tsx"),
] satisfies RouteConfig;
`);

		expect(
			plan.writes.some(
				(write) => write.path === "apps/web/app/routes/accept-invitation.tsx",
			),
		).toBe(true);
	});

	it("lists API routes only on a self-hosted primary beside a React Router client", async () => {
		const plan = await plannedProject({
			slug: "acme",
			web: "react-router",
			backend: "self",
			rpc: "trpc",
			authentication: "better-auth",
			orm: "drizzle",
			database: "sqlite",
			webApps: [{ name: "admin", framework: "react-router", client: true }],
		});

		const routes = (app: string) =>
			plan.writes.find((write) => write.path === `apps/${app}/app/routes.ts`)
				?.content;

		expect(routes("web")).toContain(
			'  route("api/trpc/*", "routes/api.trpc.$.ts"),\n  route("api/auth/*", "routes/api.auth.$.ts"),\n',
		);

		expect(routes("admin")).toBe(bareRoutes);
	});
});
