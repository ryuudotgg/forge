import type { AddonDefinition, Contribution } from "@ryuujs/core";
import { moduleCapabilities, templateModuleTarget } from "@ryuujs/core";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import type { ForgeConfig } from "../src";
import {
	betterAuth,
	biome,
	gitignore,
	loadAddonDefinition,
	resolveBuiltins,
	shared,
	tailwind,
	trpc,
	typescript,
} from "../src";
import { readTemplate } from "../src/template";

const commitlint = loadAddonDefinition("commitlint").addon;
const githubCi = loadAddonDefinition("github-ci").addon;
const lefthook = loadAddonDefinition("lefthook").addon;
const vscode = loadAddonDefinition("vscode").addon;

const placeholderPattern = /__[A-Z_]+__/;

function contributionsOf(
	addon: AddonDefinition<ForgeConfig>,
	config: ForgeConfig,
): ReadonlyArray<Contribution> {
	const result = addon.contribute({ config });
	if (Effect.isEffect(result) || result instanceof Promise)
		throw new Error(`Unexpected Contribution Shape: ${addon.id}`);

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
			contribution.target._tag === "EnsuredModuleTarget" &&
			contribution.target.moduleKey === moduleKey,
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

describe("better-auth addon", () => {
	it("refuses to contribute without an orm", () => {
		expect(() =>
			contributionsOf(betterAuth, {
				authentication: "better-auth",
				slug: "acme",
			}),
		).toThrow("You need to add an ORM before you can use Better Auth.");
	});

	it("renders the prisma index with the resolved datasource provider", () => {
		const contributions = contributionsOf(betterAuth, {
			authentication: "better-auth",
			orm: "prisma",
			slug: "acme",
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
		const contributions = contributionsOf(betterAuth, {
			authentication: "better-auth",
			database: "mysql",
			databaseProvider: "planetscale",
			orm: "drizzle",
			slug: "acme",
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
		const contributions = contributionsOf(betterAuth, {
			authentication: "better-auth",
			orm: "prisma",
			slug: "acme",
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
		});
		const npmEnv = linesSurfaces(npmContributions, "rootEnv", "Better Auth");
		expect(npmEnv[0]?.lines[0]).toBe("# @use npx @better-auth/cli secret");
	});

	it("contributes the web route and auth dependencies", () => {
		const contributions = contributionsOf(betterAuth, {
			authentication: "better-auth",
			orm: "prisma",
			slug: "acme",
		});

		const route = leafFile(contributions, "app/api/auth/[...all]/route.ts");
		expect(route.target).toEqual({
			_tag: "EnsuredModuleTarget",
			moduleKey: "web",
		});
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
});

describe("trpc addon", () => {
	it("wires the db context when an orm is configured", () => {
		const contributions = contributionsOf(trpc, {
			orm: "drizzle",
			rpc: "trpc",
			slug: "acme",
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
		const contributions = contributionsOf(trpc, { rpc: "trpc", slug: "acme" });

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
		const contributions = contributionsOf(trpc, {
			orm: "drizzle",
			rpc: "trpc",
			slug: "acme",
		});

		const paths = [
			"trpc/query-client.ts",
			"trpc/server.ts",
			"trpc/react.tsx",
			"app/api/trpc/[trpc]/route.ts",
		];

		for (const path of paths) {
			const file = leafFile(contributions, path);
			expect(file.target, path).toEqual({
				_tag: "EnsuredModuleTarget",
				moduleKey: "web",
			});
			expect(file.content, path).not.toMatch(placeholderPattern);
		}

		expect(leafFile(contributions, "trpc/server.ts").content).toContain(
			'from "@acme/trpc"',
		);
	});
});

describe("typescript addon", () => {
	it("emits the root tsconfig and the tooling package", () => {
		const contributions = contributionsOf(typescript, { slug: "acme" });
		expect(contributions).toHaveLength(5);

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

	it("extends base.json from the nextjs and react-library configs", () => {
		const contributions = contributionsOf(typescript, { slug: "acme" });

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

	it("emits the static sections exactly once", () => {
		const contributions = contributionsOf(gitignore, {});

		const sections = [
			["Dependencies", ["node_modules/"]],
			["Forge", [".forge/"]],
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
		const resolved = await Effect.runPromise(
			resolveBuiltins({
				authentication: "clerk",
				name: "Acme",
				orm: "drizzle",
				packageManager: "pnpm",
				path: ".",
				platforms: ["web"],
				runtime: "Node.js",
				slug: "acme",
				web: "nextjs",
			}),
		);

		const ids = resolved.map((entry) => entry.id);
		expect(ids).toContain("drizzle");
		expect(ids).not.toContain("better-auth");
		expect(resolved.filter((entry) => entry.category === "auth")).toEqual([]);
	});
});
