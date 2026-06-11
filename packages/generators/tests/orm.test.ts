import type {
	AddonDefinition,
	Contribution,
	EnsureModuleContribution,
	LeafTextFileContribution,
	ManagedDependenciesSurfaceContribution,
	ManagedJsonSurfaceContribution,
	ManagedLinesSurfaceContribution,
	ManagedScriptsSurfaceContribution,
} from "@ryuujs/core";
import { describe, expect, it } from "vitest";
import type { ForgeConfig } from "../src/config";
import { drizzle, prisma } from "../src/index";

function contributionsFor(
	addon: AddonDefinition<ForgeConfig>,
	config: ForgeConfig,
): ReadonlyArray<Contribution> {
	const result = addon.contribute({ config });
	if (!Array.isArray(result))
		throw new Error(`Unexpected Contribution Result: ${addon.id}`);

	return result;
}

function ensuredModule(
	contributions: ReadonlyArray<Contribution>,
): EnsureModuleContribution {
	const found = contributions.find(
		(contribution): contribution is EnsureModuleContribution =>
			contribution._tag === "EnsureModuleContribution",
	);
	if (found === undefined) throw new Error("Missing Module Contribution");

	return found;
}

function leafFiles(
	contributions: ReadonlyArray<Contribution>,
): ReadonlyArray<LeafTextFileContribution> {
	return contributions.filter(
		(contribution): contribution is LeafTextFileContribution =>
			contribution._tag === "LeafTextFileContribution",
	);
}

function leafFile(
	contributions: ReadonlyArray<Contribution>,
	path: string,
): string {
	const found = leafFiles(contributions).find((file) => file.path === path);
	if (found === undefined) throw new Error(`Missing Leaf File: ${path}`);

	return found.content;
}

function moduleJson(
	contributions: ReadonlyArray<Contribution>,
	moduleKey: string,
	surface: ManagedJsonSurfaceContribution["surface"],
): Record<string, unknown> {
	const found = contributions.find(
		(contribution): contribution is ManagedJsonSurfaceContribution =>
			contribution._tag === "ManagedJsonSurfaceContribution" &&
			contribution.target._tag === "EnsuredModuleTarget" &&
			contribution.target.moduleKey === moduleKey &&
			contribution.surface === surface,
	);
	if (found === undefined)
		throw new Error(`Missing Json Contribution: ${moduleKey} ${surface}`);

	return found.value;
}

function moduleDependencies(
	contributions: ReadonlyArray<Contribution>,
	moduleKey: string,
): ManagedDependenciesSurfaceContribution["dependencies"] {
	const found = contributions.find(
		(contribution): contribution is ManagedDependenciesSurfaceContribution =>
			contribution._tag === "ManagedDependenciesSurfaceContribution" &&
			contribution.target._tag === "EnsuredModuleTarget" &&
			contribution.target.moduleKey === moduleKey,
	);
	if (found === undefined)
		throw new Error(`Missing Dependencies Contribution: ${moduleKey}`);

	return found.dependencies;
}

function moduleScripts(
	contributions: ReadonlyArray<Contribution>,
	moduleKey: string,
): Record<string, string> {
	const found = contributions.find(
		(contribution): contribution is ManagedScriptsSurfaceContribution =>
			contribution._tag === "ManagedScriptsSurfaceContribution" &&
			contribution.target._tag === "EnsuredModuleTarget" &&
			contribution.target.moduleKey === moduleKey,
	);
	if (found === undefined)
		throw new Error(`Missing Scripts Contribution: ${moduleKey}`);

	return found.scripts;
}

function projectScripts(
	contributions: ReadonlyArray<Contribution>,
): Record<string, string> {
	const found = contributions.find(
		(contribution): contribution is ManagedScriptsSurfaceContribution =>
			contribution._tag === "ManagedScriptsSurfaceContribution" &&
			contribution.target._tag === "ProjectTarget",
	);
	if (found === undefined) throw new Error("Missing Root Scripts Contribution");

	return found.scripts;
}

function projectLines(
	contributions: ReadonlyArray<Contribution>,
	surface: ManagedLinesSurfaceContribution["surface"],
): ManagedLinesSurfaceContribution | undefined {
	return contributions.find(
		(contribution): contribution is ManagedLinesSurfaceContribution =>
			contribution._tag === "ManagedLinesSurfaceContribution" &&
			contribution.target._tag === "ProjectTarget" &&
			contribution.surface === surface,
	);
}

describe("prisma addon", () => {
	it("scaffolds the db package for local postgres by default", () => {
		const contributions = contributionsFor(prisma, {
			slug: "acme",
			orm: "prisma",
		});

		expect(ensuredModule(contributions)).toMatchObject({
			moduleKey: "db",
			root: "packages/db",
			module: { type: "package", capabilities: ["db", "prisma"] },
		});

		const schema = leafFile(contributions, "prisma/schema.prisma");
		expect(schema).toContain('provider = "postgresql"');
		expect(schema).toContain(" @db.Timestamptz");
		expect(schema).not.toContain("relationMode");
		expect(schema).not.toContain(" @db.Text");
		expect(schema).not.toContain("model Session");

		expect(leafFile(contributions, "src/client.ts")).toContain(
			"@prisma/adapter-pg",
		);
		expect(leafFile(contributions, "prisma.config.ts")).toContain(
			"process.env.DATABASE_DIRECT_URL",
		);
	});

	it("emulates relations in the planetscale mysql schema", () => {
		const contributions = contributionsFor(prisma, {
			slug: "acme",
			orm: "prisma",
			database: "mysql",
			databaseProvider: "planetscale",
			authentication: "better-auth",
		});

		const schema = leafFile(contributions, "prisma/schema.prisma");
		expect(schema).toContain('provider = "mysql"');
		expect(schema).toContain('relationMode = "prisma"');
		expect(schema).toContain("  @@index([userId])");
		expect(schema).toContain(" @db.Text");
		expect(schema).not.toContain("@db.Timestamptz");

		expect(leafFile(contributions, "prisma.config.ts")).toContain(
			"process.env.DATABASE_URL",
		);
		expect(leafFile(contributions, "src/client.ts")).toContain(
			"@prisma/adapter-planetscale",
		);

		expect(moduleDependencies(contributions, "db")).toContainEqual(
			expect.objectContaining({
				name: "@prisma/adapter-planetscale",
				type: "dependencies",
			}),
		);

		expect(projectLines(contributions, "rootEnv")?.lines).toEqual([
			'DATABASE_URL="mysql://user:password@aws.connect.psdb.cloud/database?sslaccept=strict"',
		]);
	});

	it("renders the auth models only for better-auth", () => {
		const withAuth = contributionsFor(prisma, {
			slug: "acme",
			orm: "prisma",
			authentication: "better-auth",
		});

		const schema = leafFile(withAuth, "prisma/schema.prisma");
		expect(schema).toContain("model Session");
		expect(schema).toContain('@@map("sessions")');
		expect(schema).not.toContain("@@index");
		expect(schema).not.toContain("__");
	});

	it("gitignores the generated client and sqlite files per provider", () => {
		const postgres = contributionsFor(prisma, { slug: "acme", orm: "prisma" });
		expect(projectLines(postgres, "gitignore")?.lines).toEqual([
			"packages/db/src/generated/",
		]);

		const sqlite = contributionsFor(prisma, {
			slug: "acme",
			orm: "prisma",
			database: "sqlite",
		});
		expect(projectLines(sqlite, "gitignore")?.lines).toEqual([
			"packages/db/src/generated/",
			"/local.db*",
		]);
		expect(leafFile(sqlite, "src/client.ts")).toContain(
			"@prisma/adapter-better-sqlite3",
		);

		const turso = contributionsFor(prisma, {
			slug: "acme",
			orm: "prisma",
			database: "sqlite",
			databaseProvider: "turso",
		});
		expect(projectLines(turso, "gitignore")?.lines).toEqual([
			"packages/db/src/generated/",
			"/packages/db/prisma/local.db*",
		]);
	});

	it("wires the db scripts through pnpm by default", () => {
		const contributions = contributionsFor(prisma, {
			slug: "acme",
			orm: "prisma",
		});

		expect(moduleJson(contributions, "db", "packageJson")).toMatchObject({
			name: "@acme/db",
			scripts: {
				generate: "prisma generate",
				migrate: "pnpm with-env prisma migrate dev",
			},
		});
		expect(moduleScripts(contributions, "web")["db:migrate"]).toBe(
			"pnpm --filter @acme/db run migrate",
		);
		expect(projectScripts(contributions).postinstall).toBe(
			"pnpm --filter @acme/db run generate",
		);
	});

	it("wires the db scripts through npm when selected", () => {
		const contributions = contributionsFor(prisma, {
			slug: "acme",
			orm: "prisma",
			packageManager: "npm",
		});

		expect(moduleJson(contributions, "db", "packageJson")).toMatchObject({
			scripts: { migrate: "npm run with-env -- prisma migrate dev" },
		});
		expect(moduleScripts(contributions, "web")["db:migrate"]).toBe(
			"npm run migrate --prefix ../../packages/db",
		);
		expect(projectScripts(contributions).postinstall).toBe(
			"npm run generate --prefix packages/db",
		);
	});

	it("writes provider values to .env and examples to .env.example", () => {
		const contributions = contributionsFor(prisma, {
			slug: "acme",
			orm: "prisma",
		});

		const rootEnv = projectLines(contributions, "rootEnv");
		expect(rootEnv?.section).toBe("Database");
		expect(rootEnv?.lines).toEqual([
			'DATABASE_URL="postgresql://user:password@localhost:5432/postgres?sslmode=disable"',
			'DATABASE_DIRECT_URL="postgresql://user:password@localhost:5432/postgres?sslmode=disable"',
		]);

		expect(projectLines(contributions, "rootEnvExample")?.lines).toEqual([
			'DATABASE_URL="postgresql://user:password@host:5432/database?sslmode=require"',
			'DATABASE_DIRECT_URL="postgresql://user:password@host:5432/database?sslmode=require"',
		]);
	});
});

describe("drizzle addon", () => {
	it("scaffolds the postgres schema without auth by default", () => {
		const contributions = contributionsFor(drizzle, {
			slug: "acme",
			orm: "drizzle",
		});

		expect(ensuredModule(contributions)).toMatchObject({
			moduleKey: "db",
			root: "packages/db",
			module: { type: "package", capabilities: ["db", "drizzle"] },
		});

		const paths = leafFiles(contributions).map((file) => file.path);
		expect(paths).toContain("src/schema/users/users.ts");
		expect(paths).not.toContain("src/schema/auth.ts");

		expect(leafFile(contributions, "src/schema/users/users.ts")).toContain(
			"pgTable",
		);
		expect(leafFile(contributions, "src/schema/index.ts")).toBe(
			'export * from "./users";\n',
		);

		const index = leafFile(contributions, "src/index.ts");
		expect(index).toContain("NodePgDatabase");
		expect(index).toContain("drizzle-orm/node-postgres");

		const config = leafFile(contributions, "drizzle.config.ts");
		expect(config).toContain('dialect: "postgresql"');
		expect(config).toContain("dbCredentials: { url: env.DATABASE_DIRECT_URL }");
	});

	it("exports the auth schema for better-auth", () => {
		const contributions = contributionsFor(drizzle, {
			slug: "acme",
			orm: "drizzle",
			authentication: "better-auth",
		});

		expect(leafFile(contributions, "src/schema/auth.ts")).toContain(
			'export const sessions = pgTable("sessions"',
		);
		expect(leafFile(contributions, "src/schema/index.ts")).toBe(
			'export * from "./auth";\nexport * from "./users";\n',
		);
	});

	it("points drizzle-kit at the turso credentials", () => {
		const contributions = contributionsFor(drizzle, {
			slug: "acme",
			orm: "drizzle",
			database: "sqlite",
			databaseProvider: "turso",
		});

		const config = leafFile(contributions, "drizzle.config.ts");
		expect(config).toContain('dialect: "turso"');
		expect(config).toContain(
			"dbCredentials: { url: env.TURSO_DATABASE_URL, authToken: env.TURSO_AUTH_TOKEN }",
		);

		expect(leafFile(contributions, "src/client.ts")).toContain(
			"authToken: env.TURSO_AUTH_TOKEN",
		);

		expect(projectLines(contributions, "gitignore")).toBeUndefined();

		expect(projectLines(contributions, "rootEnv")?.lines).toEqual([
			'TURSO_DATABASE_URL="libsql://database-name-org.aws-us-east-1.turso.io"',
			'TURSO_AUTH_TOKEN="change-me"',
		]);
		expect(projectLines(contributions, "rootEnvExample")?.lines).toEqual([
			'TURSO_DATABASE_URL="libsql://database-name-org.aws-us-east-1.turso.io"',
			'TURSO_AUTH_TOKEN=""',
		]);
	});

	it("gitignores the local database for the libsql file client", () => {
		const contributions = contributionsFor(drizzle, {
			slug: "acme",
			orm: "drizzle",
			database: "sqlite",
		});

		const gitignore = projectLines(contributions, "gitignore");
		expect(gitignore?.section).toBe("Database");
		expect(gitignore?.lines).toEqual(["/local.db*"]);

		expect(leafFile(contributions, "src/client.ts")).toContain(
			"createClient({ url: env.DATABASE_URL })",
		);
	});

	it("maps the planetscale mysql driver deps and templates", () => {
		const contributions = contributionsFor(drizzle, {
			slug: "acme",
			orm: "drizzle",
			database: "mysql",
			databaseProvider: "planetscale",
		});

		const dependencies = moduleDependencies(contributions, "db");
		expect(dependencies).toContainEqual(
			expect.objectContaining({
				name: "@planetscale/database",
				type: "dependencies",
			}),
		);
		expect(dependencies).toContainEqual(
			expect.objectContaining({ name: "drizzle-kit", type: "devDependencies" }),
		);
		expect(dependencies).toContainEqual(
			expect.objectContaining({ name: "mysql2", type: "devDependencies" }),
		);

		expect(leafFile(contributions, "src/schema/users/users.ts")).toContain(
			"mysqlTable",
		);

		const index = leafFile(contributions, "src/index.ts");
		expect(index).toContain("PlanetScaleDatabase");
		expect(index).toContain("drizzle-orm/planetscale-serverless");
	});

	it("runs the db scripts through the selected package manager", () => {
		const pnpm = contributionsFor(drizzle, { slug: "acme", orm: "drizzle" });
		expect(moduleJson(pnpm, "db", "packageJson")).toMatchObject({
			scripts: { push: "pnpm with-env drizzle-kit push" },
		});
		expect(moduleScripts(pnpm, "web")["db:push"]).toBe(
			"pnpm --filter @acme/db run push",
		);

		const npm = contributionsFor(drizzle, {
			slug: "acme",
			orm: "drizzle",
			packageManager: "npm",
		});
		expect(moduleJson(npm, "db", "packageJson")).toMatchObject({
			scripts: { push: "npm run with-env -- drizzle-kit push" },
		});
		expect(moduleScripts(npm, "web")["db:push"]).toBe(
			"npm run push --prefix ../../packages/db",
		);
	});
});
