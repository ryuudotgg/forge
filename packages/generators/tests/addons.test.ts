import type {
	AdapterModule,
	AddonDefinition,
	Contribution,
	FrameworkDefinition,
} from "@ryuujs/core";
import {
	defineFramework,
	moduleCapabilities,
	moduleTarget,
	slotPath,
	templateModuleTarget,
} from "@ryuujs/core";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import type { ForgeConfig } from "../src";
import {
	betterAuth,
	biome,
	builtins,
	gitignore,
	loadAddonDefinition,
	shared,
	tailwind,
	trpc,
	typescript,
} from "../src";
import { honoFramework } from "../src/frameworks/hono";
import { nextjsFramework } from "../src/frameworks/nextjs";
import { reactRouterFramework } from "../src/frameworks/react-router";
import { tanstackStartFramework } from "../src/frameworks/tanstack-start";
import { readTemplate } from "../src/template";
import { versions } from "../src/versions";
import { plannedDefinitionIds } from "./planner-harness";

const commitlint = loadAddonDefinition("commitlint").addon;
const githubCi = loadAddonDefinition("github-ci").addon;
const lefthook = loadAddonDefinition("lefthook").addon;
const vitest = loadAddonDefinition("vitest").addon;
const vscode = loadAddonDefinition("vscode").addon;

const placeholderPattern = /__[A-Z_]+__/;

function contributionsOf(
	addon: AddonDefinition<ForgeConfig>,
	config: ForgeConfig,
	frameworks: ReadonlyArray<FrameworkDefinition> = [nextjsFramework],
): ReadonlyArray<Contribution> {
	const result = addon.contribute({ commandVersions: {}, config, frameworks });
	if (Effect.isEffect(result) || result instanceof Promise)
		throw new Error(`Unexpected Contribution Shape: ${addon.id}`);

	return result;
}

function adapterContributionsOf(
	addonId: string,
	config: ForgeConfig,
	framework: FrameworkDefinition,
	slots: Readonly<Record<string, string>>,
): ReadonlyArray<Contribution> {
	const adapter = builtins.adapters.find(
		(entry) => entry.addon === addonId && entry.framework === framework.id,
	);

	if (!adapter) throw new Error(`Missing Adapter: ${addonId}:${framework.id}`);

	const module: AdapterModule = {
		config: {
			id: "abcde",
			type: "app",
			framework: framework.id,
			template: { id: `${framework.id}/base`, version: 1 },
			slots,
		},
		id: "abcde",
		root: "apps/web",
	};

	const result = adapter.contribute({
		config,
		framework,
		module,
		slots,
	});

	if (Effect.isEffect(result) || result instanceof Promise)
		throw new Error(`Unexpected Adapter Contribution Shape: ${addonId}`);

	return result;
}

function ofTag<Tag extends Contribution["_tag"]>(
	contributions: ReadonlyArray<Contribution>,
	tag: Tag,
): ReadonlyArray<Extract<Contribution, { _tag: Tag }>> {
	return contributions.filter(
		(contribution): contribution is Extract<Contribution, { _tag: Tag }> =>
			contribution._tag === tag,
	);
}

function leafFile(contributions: ReadonlyArray<Contribution>, path: string) {
	const found = ofTag(contributions, "LeafTextFileContribution").find(
		(contribution) => contribution.path === path,
	);

	if (!found) throw new Error(`Missing Leaf File: ${path}`);

	return found;
}

function jsonSurface(
	contributions: ReadonlyArray<Contribution>,
	surface: string,
) {
	const found = ofTag(contributions, "ManagedJsonSurfaceContribution").find(
		(contribution) => contribution.surface === surface,
	);

	if (!found) throw new Error(`Missing Json Surface: ${surface}`);

	return found;
}

function linesSurfaces(
	contributions: ReadonlyArray<Contribution>,
	surface: string,
	section: string,
) {
	return ofTag(contributions, "ManagedLinesSurfaceContribution").filter(
		(contribution) =>
			contribution.surface === surface && contribution.section === section,
	);
}

function moduleDependencySurface(
	contributions: ReadonlyArray<Contribution>,
	moduleKey: string,
) {
	const found = ofTag(
		contributions,
		"ManagedDependenciesSurfaceContribution",
	).find(
		(contribution) =>
			(contribution.target._tag === "EnsuredModuleTarget" &&
				contribution.target.moduleKey === moduleKey) ||
			(contribution.target._tag === "ResolvedModuleTarget" &&
				moduleKey === "web"),
	);

	if (!found) throw new Error(`Missing Dependency Surface: ${moduleKey}`);

	return found;
}

function projectDependencySurface(contributions: ReadonlyArray<Contribution>) {
	const found = ofTag(
		contributions,
		"ManagedDependenciesSurfaceContribution",
	).find((contribution) => contribution.target._tag === "ProjectTarget");
	if (!found) throw new Error("Missing Dependency Surface: project");

	return found;
}

function parseJson(content: string): unknown {
	return JSON.parse(content);
}

function betterAuthContributions(
	config: ForgeConfig,
	framework: FrameworkDefinition = nextjsFramework,
) {
	return [
		...contributionsOf(betterAuth, config, [framework]),
		...adapterContributionsOf("better-auth", config, framework, {
			auth:
				framework.id === "tanstack-start"
					? "src/routes/api/auth/$.ts"
					: framework.id === "react-router"
						? "app/routes/api.auth.$.ts"
						: "app/api/auth/[...all]/route.ts",
		}),
	];
}

describe("better-auth addon", () => {
	it.each([
		["nextjs", "process.env.NEXT_PUBLIC_SERVER_URL"],
		["tanstack-router", "import.meta.env.VITE_SERVER_URL"],
	] as const)(
		"renders a credentialed standalone client for %s",
		(web, serverUrl) => {
			const contributions = contributionsOf(
				betterAuth,
				{
					authentication: "better-auth",
					backend: "hono",
					orm: "drizzle",
					slug: "acme",
					web,
				},
				[honoFramework],
			);
			const client = leafFile(contributions, "src/client.ts");
			expect(client.content).toContain(serverUrl);
			expect(client.content).toContain('credentials: "include"');
			expect(client.content).not.toMatch(placeholderPattern);
		},
	);

	it("refuses to contribute without an orm", () => {
		expect(() =>
			contributionsOf(betterAuth, {
				authentication: "better-auth",
				slug: "acme",
				web: "nextjs",
			}),
		).toThrow("You need to add an ORM before you can use Better Auth.");
	});

	it("requires an orm when contributing through an adapter", () => {
		expect(() =>
			adapterContributionsOf(
				"better-auth",
				{
					authentication: "better-auth",
					slug: "acme",
					web: "nextjs",
				},
				nextjsFramework,
				{ auth: "app/api/auth/[...all]/route.ts" },
			),
		).toThrow("Orm Required: better-auth adapter for nextjs");
	});

	it("renders the prisma index with the resolved datasource provider", () => {
		const contributions = betterAuthContributions({
			authentication: "better-auth",
			orm: "prisma",
			slug: "acme",
			web: "nextjs",
		});

		const index = leafFile(contributions, "src/index.ts");
		expect(index.target).toEqual({
			_tag: "EnsuredModuleTarget",
			moduleKey: "auth",
		});
		expect(index.content).toContain('import { db } from "@acme/db/client";');
		expect(index.content).toContain(
			'prismaAdapter(db, { provider: "postgresql" })',
		);
		expect(index.content).not.toMatch(placeholderPattern);
	});

	it("renders the drizzle index with the dialect's adapter provider", () => {
		const contributions = betterAuthContributions({
			authentication: "better-auth",
			database: "mysql",
			databaseProvider: "planetscale",
			orm: "drizzle",
			slug: "acme",
			web: "nextjs",
		});

		const index = leafFile(contributions, "src/index.ts");
		expect(index.content).toContain("drizzleAdapter(db, {");
		expect(index.content).toContain('provider: "mysql",');
		expect(index.content).toContain(
			'import { accounts, sessions, users, verifications } from "@acme/db/schema";',
		);
		expect(index.content).not.toMatch(placeholderPattern);
	});

	it("writes env surfaces with a per-pm secret hint", () => {
		const contributions = betterAuthContributions({
			authentication: "better-auth",
			orm: "prisma",
			slug: "acme",
			web: "nextjs",
		});

		const rootEnv = linesSurfaces(contributions, "rootEnv", "Better Auth");
		expect(rootEnv).toHaveLength(1);
		expect(rootEnv[0]?.lines[0]).toBe(
			"# @use pnpm dlx @better-auth/cli secret",
		);
		expect(rootEnv[0]?.lines[1]).toMatch(/^AUTH_SECRET="[0-9a-f]{64}"$/);

		const secondRootEnv = linesSurfaces(
			contributionsOf(betterAuth, {
				authentication: "better-auth",
				orm: "prisma",
				slug: "acme",
				web: "nextjs",
			}),
			"rootEnv",
			"Better Auth",
		);
		expect(secondRootEnv[0]?.lines[1]).not.toBe(rootEnv[0]?.lines[1]);

		const rootEnvExample = linesSurfaces(
			contributions,
			"rootEnvExample",
			"Better Auth",
		);
		expect(rootEnvExample).toHaveLength(1);
		expect(rootEnvExample[0]?.lines).toContain('AUTH_SECRET=""');

		const npmContributions = contributionsOf(betterAuth, {
			authentication: "better-auth",
			orm: "prisma",
			packageManager: "npm",
			slug: "acme",
			web: "nextjs",
		});
		const npmEnv = linesSurfaces(npmContributions, "rootEnv", "Better Auth");
		expect(npmEnv[0]?.lines[0]).toBe("# @use npx @better-auth/cli secret");
	});

	it("contributes the web route and auth dependencies", () => {
		const contributions = betterAuthContributions({
			authentication: "better-auth",
			orm: "prisma",
			slug: "acme",
			web: "nextjs",
		});

		const route = ofTag(contributions, "LeafTextFileContribution").find(
			(contribution) =>
				typeof contribution.path !== "string" &&
				contribution.path.slot === "auth",
		);
		if (!route) throw new Error("Missing Leaf File: auth slot");
		expect(route.target).toEqual({
			_tag: "ResolvedModuleTarget",
			moduleId: "abcde",
			moduleRoot: "apps/web",
		});
		expect(route.path).toEqual(
			slotPath(
				{
					_tag: "ResolvedModuleTarget",
					moduleId: "abcde",
					moduleRoot: "apps/web",
				},
				"auth",
			),
		);
		expect(route.content).toContain('import { auth } from "@acme/auth";');

		const webDependencies = moduleDependencySurface(contributions, "web");
		expect(webDependencies.dependencies).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					name: "@acme/auth",
					type: "dependencies",
					version: "workspace:*",
				}),
				expect.objectContaining({ name: "better-auth", type: "dependencies" }),
			]),
		);
	});

	it("renders TanStack Start handlers and cookie plugins for both ORMs", () => {
		const authOrms: ReadonlyArray<"drizzle" | "prisma"> = ["drizzle", "prisma"];

		for (const orm of authOrms) {
			const contributions = betterAuthContributions(
				{
					authentication: "better-auth",
					database: "postgresql",
					orm,
					slug: "acme",
					web: "tanstack-start",
				},
				tanstackStartFramework,
			);
			const index = leafFile(contributions, "src/index.ts");

			expect(index.content, orm).toContain(
				'import { tanstackStartCookies } from "better-auth/tanstack-start";',
			);
			expect(index.content, orm).toContain("plugins: [tanstackStartCookies()]");
			expect(index.content, orm).not.toContain("nextCookies");

			const route = ofTag(contributions, "LeafTextFileContribution").find(
				(contribution) =>
					typeof contribution.path !== "string" &&
					contribution.path.slot === "auth",
			);
			if (!route) throw new Error("Missing Leaf File: auth slot");

			expect(route.content, orm).toContain(
				'// Loads the server-route type augmentation for createFileRoute.\nimport "@tanstack/react-start";',
			);
			expect(route.content, orm).toContain('createFileRoute("/api/auth/$")');
			expect(route.content, orm).toContain("return auth.handler(request);");
			expect(route.content, orm).not.toContain("toNextJsHandler");
		}
	});

	it("renders Next.js cookie plugins for both ORMs", () => {
		const authOrms: ReadonlyArray<"drizzle" | "prisma"> = ["drizzle", "prisma"];

		for (const orm of authOrms) {
			const contributions = betterAuthContributions({
				authentication: "better-auth",
				database: "postgresql",
				orm,
				slug: "acme",
				web: "nextjs",
			});
			const index = leafFile(contributions, "src/index.ts");

			expect(index.content, orm).toContain(
				'import { nextCookies } from "better-auth/next-js";',
			);
			expect(index.content, orm).toContain("plugins: [nextCookies()],");
		}
	});

	it("renders React Router handlers without a framework cookie plugin", () => {
		const authOrms: ReadonlyArray<"drizzle" | "prisma"> = ["drizzle", "prisma"];

		for (const orm of authOrms) {
			const contributions = betterAuthContributions(
				{
					authentication: "better-auth",
					database: "postgresql",
					orm,
					slug: "acme",
					web: "react-router",
				},
				reactRouterFramework,
			);
			const index = leafFile(contributions, "src/index.ts");
			expect(index.content, orm).not.toContain("tanstackStartCookies");
			expect(index.content, orm).not.toContain("nextCookies");
			expect(index.content, orm).not.toContain("plugins:");

			const route = ofTag(contributions, "LeafTextFileContribution").find(
				(contribution) =>
					typeof contribution.path !== "string" &&
					contribution.path.slot === "auth",
			);
			if (!route) throw new Error("Missing Leaf File: auth slot");

			expect(route.content, orm).toContain(
				'import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";',
			);
			expect(route.content, orm).toContain("return auth.handler(request);");
			expect(route.content, orm).not.toContain("createFileRoute");
		}
	});

	it("leaves API host selection to resolution and target predicates", () => {
		expect(
			betterAuth.dependencies.some(
				(dependency) => dependency.type === "template",
			),
		).toBe(false);
		expect(
			trpc.dependencies.some((dependency) => dependency.type === "template"),
		).toBe(false);
	});
});

describe("trpc addon", () => {
	it("wires the db context when an orm is configured", () => {
		const contributions = contributionsOf(trpc, {
			orm: "drizzle",
			rpc: "trpc",
			slug: "acme",
			web: "nextjs",
		});

		const trpcFile = leafFile(contributions, "src/trpc.ts");
		expect(trpcFile.content).toContain('import { db } from "@acme/db/client";');
		expect(trpcFile.content).toContain("db: typeof db;");
		expect(trpcFile.content).toContain(
			"return { db, headers: opts.headers, session };",
		);

		const dependencies = moduleDependencySurface(contributions, "trpc");
		expect(dependencies.dependencies).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					name: "@acme/db",
					type: "dependencies",
					version: "workspace:*",
				}),
			]),
		);
	});

	it("omits the db context without an orm", () => {
		const contributions = contributionsOf(trpc, {
			rpc: "trpc",
			slug: "acme",
			web: "nextjs",
		});

		const trpcFile = leafFile(contributions, "src/trpc.ts");
		expect(trpcFile.content).not.toContain("@acme/db");
		expect(trpcFile.content).not.toContain("db: typeof db");
		expect(trpcFile.content.startsWith("import { initTRPC")).toBe(true);

		const dependencies = moduleDependencySurface(contributions, "trpc");
		const names = dependencies.dependencies.map(
			(dependency) => dependency.name,
		);
		expect(names).not.toContain("@acme/db");
	});

	it("emits interpolated web-side files", () => {
		const config: ForgeConfig = {
			orm: "drizzle",
			rpc: "trpc",
			slug: "acme",
			web: "nextjs",
		};
		const contributions = adapterContributionsOf(
			"trpc",
			config,
			nextjsFramework,
			{ trpc: "app/api/trpc/[trpc]/route.ts" },
		);
		const target = moduleTarget({
			config: {
				id: "abcde",
				type: "app",
				framework: "nextjs",
				template: { id: "nextjs/base", version: 1 },
				slots: { trpc: "app/api/trpc/[trpc]/route.ts" },
			},
			id: "abcde",
			root: "apps/web",
		});

		const paths = ["trpc/query-client.ts", "trpc/server.ts", "trpc/react.tsx"];

		for (const path of paths) {
			const file = leafFile(contributions, path);
			expect(file.target, path).toEqual(target);
			expect(file.content, path).not.toMatch(placeholderPattern);
		}

		expect(leafFile(contributions, "trpc/server.ts").content).toContain(
			'from "@acme/trpc"',
		);

		const route = ofTag(contributions, "LeafTextFileContribution").find(
			(contribution) =>
				typeof contribution.path !== "string" &&
				contribution.path.slot === "trpc",
		);
		expect(route?.path).toEqual(slotPath(target, "trpc"));
	});
});

describe("typescript addon", () => {
	it("emits the root tsconfig and the tooling package", () => {
		const contributions = contributionsOf(typescript, { slug: "acme" });
		expect(contributions).toHaveLength(4);

		const rootTsconfig = jsonSurface(contributions, "rootTsconfig");
		expect(rootTsconfig.target).toEqual({ _tag: "ProjectTarget" });
		expect(rootTsconfig.value).toEqual({
			extends: "@acme/tsconfig/base.json",
		});

		const packageJson = leafFile(
			contributions,
			"tooling/tsconfig/package.json",
		);
		expect(parseJson(packageJson.content)).toEqual({
			name: "@acme/tsconfig",
			private: true,
		});
	});

	it("pins the safety-critical base compiler options", () => {
		const contributions = contributionsOf(typescript, { slug: "acme" });

		const base = leafFile(contributions, "tooling/tsconfig/base.json");
		expect(parseJson(base.content)).toMatchObject({
			compilerOptions: {
				moduleResolution: "Bundler",
				noUncheckedIndexedAccess: true,
				strict: true,
			},
		});
	});

	it("extends base.json from the selected framework and react-library configs", () => {
		const contributions = contributionsOf(typescript, {
			slug: "acme",
			web: "nextjs",
		});

		const nextjs = leafFile(contributions, "tooling/tsconfig/nextjs.json");
		expect(parseJson(nextjs.content)).toMatchObject({
			extends: "./base.json",
			compilerOptions: { jsx: "preserve", noEmit: true },
		});

		const reactLibrary = leafFile(
			contributions,
			"tooling/tsconfig/react-library.json",
		);
		expect(parseJson(reactLibrary.content)).toMatchObject({
			extends: "./base.json",
			compilerOptions: { jsx: "react-jsx" },
		});
	});

	it("emits only the selected framework's tsconfig preset", () => {
		const framework = defineFramework({
			buildOutputs: ["dist/**"],
			configFile: "start.config.ts",
			id: "tanstack-start",
			ignoreDirs: [".tanstack/"],
			name: "TanStack Start",
			sourceRoot: "",
			slots: [],
			tsconfigPreset: {
				name: "tanstack-start",
				content: {
					display: "TanStack Start",
					extends: "./base.json",
					compilerOptions: { jsx: "react-jsx" },
				},
			},
		});
		const contributions = contributionsOf(
			typescript,
			{ slug: "acme", web: "tanstack-start" },
			[framework],
		);
		const paths = ofTag(contributions, "LeafTextFileContribution").map(
			(contribution) => contribution.path,
		);

		expect(paths).toContain("tooling/tsconfig/tanstack-start.json");
		expect(paths).not.toContain("tooling/tsconfig/nextjs.json");
		expect(
			parseJson(
				leafFile(contributions, "tooling/tsconfig/tanstack-start.json").content,
			),
		).toEqual(framework.tsconfigPreset.content);
	});
});

describe("gitignore addon", () => {
	it("always ignores the .env family", () => {
		const configs: ReadonlyArray<ForgeConfig> = [
			{},
			{ web: "nextjs" },
			{ mobile: "expo" },
		];

		for (const config of configs) {
			const environment = linesSurfaces(
				contributionsOf(gitignore, config),
				"gitignore",
				"Environment",
			);

			expect(environment).toHaveLength(1);
			expect(environment[0]?.lines).toEqual([
				".env",
				".env.local",
				".env.development.local",
				".env.test.local",
				".env.production.local",
			]);
		}
	});

	it("adds build outputs per selected platform", () => {
		const baseLines = ["dist/", "build/", "out/", ".turbo/", ".cache/"];

		const bare = linesSurfaces(
			contributionsOf(gitignore, {}),
			"gitignore",
			"Build",
		);
		expect(bare[0]?.lines).toEqual(baseLines);

		const nextjs = linesSurfaces(
			contributionsOf(gitignore, { web: "nextjs" }),
			"gitignore",
			"Build",
		);
		expect(nextjs[0]?.lines).toEqual([...baseLines, ".next/"]);

		const expo = linesSurfaces(
			contributionsOf(gitignore, { mobile: "expo" }),
			"gitignore",
			"Build",
		);
		expect(expo[0]?.lines).toEqual([...baseLines, ".expo/"]);
	});

	it("reads ignored directories from the selected framework", () => {
		const framework = defineFramework({
			buildOutputs: ["dist/**"],
			configFile: "start.config.ts",
			id: "tanstack-start",
			ignoreDirs: [".tanstack/", ".output/"],
			name: "TanStack Start",
			sourceRoot: "",
			slots: [],
			tsconfigPreset: { content: {}, name: "tanstack-start" },
		});
		const build = linesSurfaces(
			contributionsOf(gitignore, { web: "tanstack-start" }, [framework]),
			"gitignore",
			"Build",
		);

		expect(build[0]?.lines).toEqual([
			"dist/",
			"build/",
			"out/",
			".turbo/",
			".cache/",
			".tanstack/",
			".output/",
		]);
	});

	it("emits the static sections exactly once", () => {
		const contributions = contributionsOf(gitignore, {});

		const sections = [
			["Dependencies", ["node_modules/"]],
			["Testing", ["coverage/"]],
		] as const;

		for (const [section, lines] of sections) {
			const found = linesSurfaces(contributions, "gitignore", section);
			expect(found, section).toHaveLength(1);
			expect(found[0]?.lines, section).toEqual(lines);
		}
	});
});

describe("lefthook addon", () => {
	it("emits only the pre-commit hook without commitlint", () => {
		const contributions = contributionsOf(lefthook, { addons: ["lefthook"] });

		expect(leafFile(contributions, "lefthook.yml").content).toBe(
			`pre-commit:
  jobs:
    - run: pnpm check:fix --staged --no-errors-on-unmatched
    - run: git update-index --again
`,
		);
	});

	it("prepends the commit-msg hook when commitlint is selected", () => {
		const contributions = contributionsOf(lefthook, {
			addons: ["commitlint", "lefthook"],
			packageManager: "npm",
		});

		expect(leafFile(contributions, "lefthook.yml").content).toBe(
			`commit-msg:
  jobs:
    - run: npx commitlint --edit {1}

pre-commit:
  jobs:
    - run: npm run check:fix -- --staged --no-errors-on-unmatched
    - run: git update-index --again
`,
		);
	});

	it("registers the prepare script and dev dependency", () => {
		const contributions = contributionsOf(lefthook, { addons: ["lefthook"] });

		const scripts = ofTag(contributions, "ManagedScriptsSurfaceContribution");
		expect(scripts).toHaveLength(1);
		expect(scripts[0]?.surface).toBe("rootPackageJson");
		expect(scripts[0]?.scripts).toEqual({ prepare: "lefthook install" });

		expect(projectDependencySurface(contributions).dependencies).toEqual([
			expect.objectContaining({ name: "lefthook", type: "devDependencies" }),
		]);
	});
});

describe("vitest addon", () => {
	it("emits per-package test wiring and a starter test when selected", () => {
		const contributions = contributionsOf(vitest, {
			addons: ["vitest"],
			web: "nextjs",
		});

		const config = leafFile(contributions, "vitest.config.ts");
		expect(config.target).toEqual({
			_tag: "EnsuredModuleTarget",
			moduleKey: "web",
		});
		expect(config.content).toBe(
			readTemplate("tooling/vitest/vitest.config.ts"),
		);

		const starter = leafFile(contributions, "src/forge.test.ts");
		expect(starter.target).toEqual(config.target);
		expect(starter.content).toBe(
			readTemplate("tooling/vitest/src/forge.test.ts"),
		);

		const packageScripts = ofTag(
			contributions,
			"ManagedScriptsSurfaceContribution",
		).find(
			(contribution) =>
				contribution.target._tag === "EnsuredModuleTarget" &&
				contribution.target.moduleKey === "web",
		);
		expect(packageScripts?.scripts).toEqual({ test: "vitest run" });

		const rootScripts = ofTag(
			contributions,
			"ManagedScriptsSurfaceContribution",
		).find((contribution) => contribution.target._tag === "ProjectTarget");
		expect(rootScripts?.scripts).toEqual({ test: "turbo run test" });

		expect(moduleDependencySurface(contributions, "web").dependencies).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					name: versions.vitest.name,
					type: "devDependencies",
					version: versions.vitest.version,
				}),
			]),
		);

		expect(jsonSurface(contributions, "workspaceConfig").value).toEqual({
			tasks: { test: { dependsOn: ["^test"] } },
		});
	});

	it("does not contribute when selected without a web app", () => {
		const config: ForgeConfig = {
			addons: ["vitest"],
			backend: "self",
			platforms: [],
		};

		expect(vitest.when(config)).toBe(false);
		expect(() => contributionsOf(vitest, config)).not.toThrow();
		expect(contributionsOf(vitest, config)).toEqual([]);
	});

	it("does not activate or resolve when it is not selected", async () => {
		expect(vitest.when({})).toBe(false);

		const resolved = await plannedDefinitionIds({
			name: "Acme",
			packageManager: "pnpm",
			path: ".",
			platforms: ["web"],
			runtime: "Node.js",
			slug: "acme",
			web: "nextjs",
		});

		expect(resolved).not.toContain("vitest");
	});
});

describe("github-ci addon", () => {
	it("copies the setup action for every package manager", () => {
		const packageManagers = [
			["pnpm", "pnpm"],
			["npm", "npm"],
			["Yarn", "yarn"],
			["Bun", "bun"],
		] as const;

		for (const [displayName, id] of packageManagers) {
			const contributions = contributionsOf(githubCi, {
				addons: ["github-ci"],
				packageManager: displayName,
				slug: "acme",
			});

			const action = leafFile(contributions, "tooling/github/setup/action.yml");
			expect(action.content, id).toBe(
				readTemplate(`tooling/github/setup-action.${id}.yml`),
			);
		}
	});

	it("interpolates the npm commands into ci.yml", () => {
		const contributions = contributionsOf(githubCi, {
			addons: ["github-ci"],
			packageManager: "npm",
			slug: "acme",
		});

		const ci = leafFile(contributions, ".github/workflows/ci.yml");
		expect(ci.content).toContain("run: npm run check\n");
		expect(ci.content).toContain("run: npm run check:ws");
		expect(ci.content).toContain("run: npm run typecheck");
		expect(ci.content).not.toMatch(placeholderPattern);
	});

	it("emits the github tooling package manifest", () => {
		const contributions = contributionsOf(githubCi, {
			addons: ["github-ci"],
			slug: "acme",
		});

		const packageJson = leafFile(contributions, "tooling/github/package.json");
		expect(parseJson(packageJson.content)).toEqual({
			name: "@acme/github",
			private: true,
		});
	});
});

describe("shared addon", () => {
	it("ensures the shared package module", () => {
		const contributions = contributionsOf(shared, {
			addons: ["shared"],
			slug: "acme",
		});

		const ensured = ofTag(contributions, "EnsureModuleContribution");
		expect(ensured).toHaveLength(1);
		expect(ensured[0]).toMatchObject({
			moduleKey: "shared",
			root: "packages/shared",
			module: {
				type: "package",
				template: { id: "shared", version: 1 },
				capabilities: ["shared"],
			},
		});

		const packageJson = jsonSurface(contributions, "packageJson");
		expect(packageJson.value).toMatchObject({
			name: "@acme/shared",
			exports: { ".": "./src/index.ts", "./*": "./src/*.ts" },
		});
	});

	it("copies the static sources and dependencies", () => {
		const contributions = contributionsOf(shared, {
			addons: ["shared"],
			slug: "acme",
		});

		for (const name of ["index", "id", "types"]) {
			const file = leafFile(contributions, `src/${name}.ts`);
			expect(file.target, name).toEqual({
				_tag: "EnsuredModuleTarget",
				moduleKey: "shared",
			});
			expect(file.content, name).toBe(
				readTemplate(`shared/packages/shared/src/${name}.ts`),
			);
		}

		const dependencies = moduleDependencySurface(contributions, "shared");
		expect(dependencies.dependencies).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ name: "nanoid", type: "dependencies" }),
				expect.objectContaining({
					name: "@acme/tsconfig",
					type: "devDependencies",
					version: "workspace:*",
				}),
			]),
		);
	});
});

describe("biome addon", () => {
	it("pins the biome config surface and dev dependency", () => {
		const contributions = contributionsOf(biome, { linter: "biome" });
		expect(contributions).toHaveLength(2);

		const config = jsonSurface(contributions, "biomeConfig");
		expect(config.target).toEqual({ _tag: "ProjectTarget" });
		expect(config.value).toMatchObject({
			vcs: { enabled: true, clientKind: "git" },
			formatter: { indentStyle: "space", indentWidth: 2 },
			css: { parser: { tailwindDirectives: true } },
		});

		expect(projectDependencySurface(contributions).dependencies).toEqual([
			expect.objectContaining({
				name: "@biomejs/biome",
				type: "devDependencies",
			}),
		]);
	});
});

describe("commitlint addon", () => {
	it("copies the config and commitlint dev dependencies", () => {
		const contributions = contributionsOf(commitlint, {
			addons: ["commitlint"],
		});

		expect(leafFile(contributions, "commitlint.config.ts").content).toBe(
			readTemplate("tooling/commitlint/commitlint.config.ts"),
		);

		const dependencies = projectDependencySurface(contributions).dependencies;
		expect(dependencies.map((dependency) => dependency.name)).toEqual([
			"@commitlint/cli",
			"@commitlint/config-conventional",
			"@commitlint/types",
		]);
		for (const dependency of dependencies)
			expect(dependency.type).toBe("devDependencies");
	});
});

describe("vscode addon", () => {
	it("copies both editor files from the templates", () => {
		const contributions = contributionsOf(vscode, { addons: ["vscode"] });
		expect(contributions).toHaveLength(2);

		for (const path of [".vscode/settings.json", ".vscode/extensions.json"]) {
			const file = leafFile(contributions, path);
			expect(file.content, path).toBe(
				readTemplate(`tooling/vscode/${path.replace(".vscode/", "")}`),
			);
			expect(() => parseJson(file.content), path).not.toThrow();
		}
	});
});

describe("tailwind addon", () => {
	it("adds the tailwind capability to the ui template module", () => {
		expect(contributionsOf(tailwind, {})).toEqual([
			moduleCapabilities(templateModuleTarget("ui", 1), ["tailwind"]),
		]);
	});
});

describe("first-party resolution", () => {
	it("resolves zero auth addons for clerk even with an orm installed", async () => {
		const ids = await plannedDefinitionIds({
			authentication: "clerk",
			name: "Acme",
			orm: "drizzle",
			packageManager: "pnpm",
			path: ".",
			platforms: ["web"],
			runtime: "Node.js",
			slug: "acme",
			web: "nextjs",
		});

		expect(ids).toContain("drizzle");
		expect(ids).not.toContain("better-auth");
		expect(
			builtins.addons.filter(
				(entry) => entry.category === "auth" && ids.includes(entry.id),
			),
		).toEqual([]);
	});
});
