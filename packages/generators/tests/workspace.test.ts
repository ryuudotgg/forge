import {
	type AddonDefinition,
	CommandProbe,
	CommandProbeError,
	type Contribution,
	GeneratorError,
	type ManagedSurfaceName,
} from "@ryuujs/core";
import { Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";
import { bun, type ForgeConfig, pnpm, root, yarn } from "../src/index";
import { versions } from "../src/versions";

const commandVersions: Record<string, string> = {
	node: "22.11.0",
	npm: "11.0.0",
	pnpm: "10.12.1",
};

const probeLayer = Layer.succeed(
	CommandProbe,
	CommandProbe.make({
		readVersion: (command: string) => {
			const version = commandVersions[command];
			return version === undefined
				? Effect.fail(
						new CommandProbeError({
							command,
							message: "Command Probe Failed",
							detail: "not found",
						}),
					)
				: Effect.succeed(version);
		},
	}),
);

const failingProbeLayer = Layer.succeed(
	CommandProbe,
	CommandProbe.make({
		readVersion: (command: string) =>
			Effect.fail(
				new CommandProbeError({
					command,
					message: "Command Probe Failed",
					detail: "not found",
				}),
			),
	}),
);

function rootEffect(config: ForgeConfig) {
	const result = root.contribute({ config });
	if (!Effect.isEffect(result))
		throw new Error("Missing Effect Contribution: root");

	return result;
}

function rootContributions(config: ForgeConfig) {
	return Effect.runPromise(rootEffect(config).pipe(Effect.provide(probeLayer)));
}

function syncContributions(
	addon: AddonDefinition<ForgeConfig>,
	config: ForgeConfig,
): ReadonlyArray<Contribution> {
	const result = addon.contribute({ config });
	if (Effect.isEffect(result) || result instanceof Promise)
		throw new Error(`Unexpected Async Contribution: ${addon.id}`);

	return result;
}

function jsonSurface(
	contributions: ReadonlyArray<Contribution>,
	surface: ManagedSurfaceName,
): Record<string, unknown> {
	for (const contribution of contributions)
		if (
			contribution._tag === "ManagedJsonSurfaceContribution" &&
			contribution.surface === surface
		)
			return contribution.value;

	throw new Error(`Missing JSON Surface: ${surface}`);
}

function linesSurface(
	contributions: ReadonlyArray<Contribution>,
	surface: ManagedSurfaceName,
) {
	for (const contribution of contributions)
		if (
			contribution._tag === "ManagedLinesSurfaceContribution" &&
			contribution.surface === surface
		)
			return contribution;

	throw new Error(`Missing Lines Surface: ${surface}`);
}

function leafFile(
	contributions: ReadonlyArray<Contribution>,
	path: string,
): string {
	for (const contribution of contributions)
		if (
			contribution._tag === "LeafTextFileContribution" &&
			contribution.path === path
		)
			return contribution.content;

	throw new Error(`Missing Leaf File: ${path}`);
}

describe("root workspace", () => {
	it("pins the probed pnpm toolchain without workspaces", async () => {
		const packageJson = jsonSurface(
			await rootContributions({ slug: "acme" }),
			"rootPackageJson",
		);

		expect(packageJson).toMatchObject({
			name: "acme",
			private: true,
			packageManager: "pnpm@10.12.1",
			engines: { node: "22.11.0", pnpm: "^10.12.1" },
		});
		expect(packageJson).not.toHaveProperty("workspaces");
	});

	it("declares workspaces and npm engines for npm projects", async () => {
		const packageJson = jsonSurface(
			await rootContributions({ packageManager: "npm" }),
			"rootPackageJson",
		);

		expect(packageJson).toMatchObject({
			packageManager: "npm@11.0.0",
			engines: { node: "22.11.0", npm: "^11.0.0" },
			workspaces: ["apps/*", "packages/*", "tooling/*"],
		});
	});

	it("wires turbo build env and outputs from the selections", async () => {
		const turso = jsonSurface(
			await rootContributions({
				database: "sqlite",
				databaseProvider: "turso",
				orm: "drizzle",
			}),
			"workspaceConfig",
		);

		expect(turso).toMatchObject({
			tasks: {
				build: { env: ["TURSO_DATABASE_URL", "TURSO_AUTH_TOKEN"] },
			},
		});
		expect(turso).not.toHaveProperty("tasks.build.outputs");

		const nextjs = jsonSurface(
			await rootContributions({ web: "nextjs" }),
			"workspaceConfig",
		);

		expect(nextjs).toMatchObject({
			tasks: {
				build: { outputs: [".next/**", "!.next/cache/**"] },
			},
		});
		expect(nextjs).not.toHaveProperty("tasks.build.env");

		const bare = jsonSurface(await rootContributions({}), "workspaceConfig");

		expect(bare).toMatchObject({
			$schema: "https://turborepo.com/schema.json",
			ui: "tui",
			tasks: {
				build: { dependsOn: ["^build"], inputs: ["$TURBO_DEFAULT$", ".env*"] },
				dev: { cache: false, persistent: true },
				typecheck: { dependsOn: ["^typecheck"] },
			},
		});
		expect(bare).not.toHaveProperty("tasks.build.env");
		expect(bare).not.toHaveProperty("tasks.build.outputs");
	});

	it("pins the probed runtime version in .nvmrc", async () => {
		expect(leafFile(await rootContributions({}), ".nvmrc")).toBe("22.11.0\n");
	});

	it("fails with a generator error when the runtime probe fails", async () => {
		const error = await Effect.runPromise(
			rootEffect({}).pipe(Effect.flip, Effect.provide(failingProbeLayer)),
		);

		expect(error).toBeInstanceOf(GeneratorError);
		expect(error.generatorId).toBe("root");
		expect(error.message).toBe("Command Version Probe Failed: node not found");
	});

	it("fails with a generator error when the package manager probe fails", async () => {
		const error = await Effect.runPromise(
			rootEffect({ packageManager: "Bun" }).pipe(
				Effect.flip,
				Effect.provide(probeLayer),
			),
		);

		expect(error).toBeInstanceOf(GeneratorError);
		expect(error.generatorId).toBe("root");
		expect(error.message).toBe("Command Version Probe Failed: bun not found");
	});
});

describe("pnpm workspace", () => {
	it("quotes scoped catalog entries and leaves bare names unquoted", () => {
		const contributions = syncContributions(pnpm, {});

		expect(contributions).toHaveLength(1);

		const yaml = leafFile(contributions, "pnpm-workspace.yaml");

		expect(yaml).toContain(
			'packages:\n  - "apps/*"\n  - "packages/*"\n  - "tooling/*"\n',
		);
		expect(yaml).toContain('  "@tanstack/react-query": ^5.90.5');
		expect(yaml).toContain(`  next: ${versions.next.version}`);
		expect(yaml).not.toContain('"next"');
	});

	it("allows only the baseline native builds by default", () => {
		const yaml = leafFile(syncContributions(pnpm, {}), "pnpm-workspace.yaml");

		expect(yaml).toContain(
			"allowBuilds:\n  esbuild: true\n  lefthook: true\n  msw: true\n  sharp: true\n",
		);
		expect(yaml.endsWith("  sharp: true\n")).toBe(true);
		expect(yaml).not.toContain("@prisma/engines");
		expect(yaml).not.toContain("better-sqlite3: true");
		expect(yaml).not.toContain("prisma: true");
	});

	it("allows the prisma native builds for the prisma orm", () => {
		const postgres = leafFile(
			syncContributions(pnpm, { orm: "prisma" }),
			"pnpm-workspace.yaml",
		);

		expect(postgres).toContain(
			'allowBuilds:\n  "@prisma/engines": true\n  esbuild: true\n  lefthook: true\n  msw: true\n  prisma: true\n  sharp: true\n',
		);
		expect(postgres).not.toContain("better-sqlite3: true");

		const sqlite = leafFile(
			syncContributions(pnpm, { database: "sqlite", orm: "prisma" }),
			"pnpm-workspace.yaml",
		);

		expect(sqlite).toContain(
			'allowBuilds:\n  "@prisma/engines": true\n  better-sqlite3: true\n  esbuild: true\n  lefthook: true\n  msw: true\n  prisma: true\n  sharp: true\n',
		);
	});

	it("orders catalog groups with comments and blank separators", () => {
		const yaml = leafFile(syncContributions(pnpm, {}), "pnpm-workspace.yaml");
		const lines = yaml.split("\n");
		const comments = lines.filter((line) => line.startsWith("  # "));

		expect(comments).toEqual([
			"  # Framework",
			"  # UI",
			"  # Styling",
			"  # Validation & Env",
			"  # Database",
			"  # Utilities",
			"  # Tooling",
			"  # Types",
		]);

		for (const [index, line] of lines.entries())
			if (line.startsWith("  # "))
				expect(lines[index - 1], line).toBe(
					line === "  # Framework" ? "catalog:" : "",
				);
	});
});

describe("yarn workspace", () => {
	it("forces the node-modules linker", () => {
		const contributions = syncContributions(yarn, { packageManager: "Yarn" });

		expect(leafFile(contributions, ".yarnrc.yml")).toBe(
			"nodeLinker: node-modules\n",
		);
	});

	it("ignores yarn state files while keeping the release allowlist", () => {
		const gitignore = linesSurface(
			syncContributions(yarn, { packageManager: "Yarn" }),
			"gitignore",
		);

		expect(gitignore.section).toBe("Yarn");
		expect(gitignore.lines).toEqual([
			".pnp.*",
			".yarn/*",
			"!.yarn/patches",
			"!.yarn/plugins",
			"!.yarn/releases",
			"!.yarn/sdks",
			"!.yarn/versions",
		]);
	});
});

describe("bun workspace", () => {
	it("only runs for bun projects", () => {
		expect(bun.when({ packageManager: "Bun" })).toBe(true);
		expect(bun.when({ packageManager: "pnpm" })).toBe(false);
		expect(bun.when({})).toBe(false);
	});

	it("trusts the baseline build scripts", () => {
		const packageJson = jsonSurface(
			syncContributions(bun, { packageManager: "Bun" }),
			"rootPackageJson",
		);

		expect(packageJson.trustedDependencies).toEqual([
			"esbuild",
			"lefthook",
			"msw",
			"sharp",
		]);
	});

	it("trusts the prisma build scripts for the prisma orm", () => {
		const packageJson = jsonSurface(
			syncContributions(bun, { orm: "prisma", packageManager: "Bun" }),
			"rootPackageJson",
		);

		expect(packageJson.trustedDependencies).toEqual([
			"@prisma/engines",
			"esbuild",
			"lefthook",
			"msw",
			"prisma",
			"sharp",
		]);
	});

	it("trusts better-sqlite3 when prisma uses the local sqlite client", () => {
		const packageJson = jsonSurface(
			syncContributions(bun, {
				database: "sqlite",
				orm: "prisma",
				packageManager: "Bun",
			}),
			"rootPackageJson",
		);

		expect(packageJson.trustedDependencies).toEqual([
			"@prisma/engines",
			"better-sqlite3",
			"esbuild",
			"lefthook",
			"msw",
			"prisma",
			"sharp",
		]);
	});
});
