import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	createProject,
	readJson,
	type ScenarioProject,
	withScenarioWorkspace,
} from "../utils/harness";

interface PackageJson {
	readonly dependencies?: Record<string, string>;
	readonly devDependencies?: Record<string, string>;
	readonly scripts?: Record<string, string>;
}

interface GeneratedDbPackage {
	readonly client: string;
	readonly dbEnv: string;
	readonly env: string;
	readonly envExample: string;
	readonly index: string;
	readonly packageJson: PackageJson;
	readonly prismaConfig: string;
	readonly schema: string;
}

async function createPrismaProject(
	workspace: ScenarioProject,
	config?: Record<string, unknown>,
): Promise<GeneratedDbPackage> {
	await createProject(workspace, {
		database: "postgresql",
		linter: "biome",
		orm: "prisma",
		packageManager: "pnpm",
		style: "tailwind",
		web: "nextjs",
		...config,
	});

	const readText = (path: string) =>
		readFile(join(workspace.projectRoot, path), "utf-8");

	const [
		client,
		dbEnv,
		env,
		envExample,
		index,
		packageJson,
		prismaConfig,
		schema,
	] = await Promise.all([
		readText("packages/db/src/client.ts"),
		readText("packages/db/env.ts"),
		readText(".env"),
		readText(".env.example"),
		readText("packages/db/src/index.ts"),
		readJson<PackageJson>(
			join(workspace.projectRoot, "packages/db/package.json"),
		),
		readText("packages/db/prisma.config.ts"),
		readText("packages/db/prisma/schema.prisma"),
	]);

	return {
		client,
		dbEnv,
		env,
		envExample,
		index,
		packageJson,
		prismaConfig,
		schema,
	};
}

describe("prisma", () => {
	it("generates a prisma db package wired into auth and trpc", async () => {
		await withScenarioWorkspace("prisma-full", async (workspace) => {
			const db = await createPrismaProject(workspace, {
				authentication: "better-auth",
				rpc: "trpc",
			});

			expect(db.client).toBe(
				`import { env } from "@acme/db/env";
import { PrismaClient } from "@acme/db/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({ connectionString: env.DATABASE_URL });
export const db = new PrismaClient({ adapter });
`,
			);

			expect(db.schema).toContain('provider = "prisma-client"');
			expect(db.schema).toContain('output   = "../src/generated/prisma"');
			expect(db.schema).toContain('provider = "postgresql"');
			expect(db.schema).toContain("model User {");
			expect(db.schema).toContain("model Session {");
			expect(db.schema).toContain("model Account {");
			expect(db.schema).toContain("model Verification {");
			expect(db.schema).toContain('@@map("users")');

			expect(db.prismaConfig).toContain("process.env.DATABASE_DIRECT_URL");
			expect(db.index).toContain(
				'export * from "@acme/db/generated/prisma/client";',
			);

			expect(db.dbEnv).toContain(`  server: {
    DATABASE_URL: z.url(),
    DATABASE_DIRECT_URL: z.url(),
  },`);
			expect(db.dbEnv).toContain(`  runtimeEnvStrict: {
    NODE_ENV: process.env.NODE_ENV,
    DATABASE_URL: process.env.DATABASE_URL,
    DATABASE_DIRECT_URL: process.env.DATABASE_DIRECT_URL,
  },`);

			expect(db.packageJson.dependencies).toHaveProperty("@prisma/client");
			expect(db.packageJson.dependencies).toHaveProperty("@prisma/adapter-pg");
			expect(db.packageJson.devDependencies).toHaveProperty("prisma");
			expect(db.packageJson.dependencies).not.toHaveProperty("drizzle-orm");
			expect(db.packageJson.scripts).toMatchObject({
				generate: "prisma generate",
				migrate: "pnpm with-env prisma migrate dev",
				push: "pnpm with-env prisma db push",
				studio: "pnpm with-env prisma studio",
			});

			const readText = (path: string) =>
				readFile(join(workspace.projectRoot, path), "utf-8");

			const [
				auth,
				nextConfig,
				gitignore,
				workspaceYaml,
				manifest,
				rootPackageJson,
				web,
				trpc,
			] = await Promise.all([
				readText("packages/auth/src/index.ts"),
				readText("apps/web/next.config.ts"),
				readText(".gitignore"),
				readText("pnpm-workspace.yaml"),
				readJson<{ installs: Array<{ definitionId: string }> }>(
					join(workspace.projectRoot, ".forge/manifest.json"),
				),
				readJson<PackageJson>(join(workspace.projectRoot, "package.json")),
				readJson<PackageJson>(
					join(workspace.projectRoot, "apps/web/package.json"),
				),
				readJson<PackageJson>(
					join(workspace.projectRoot, "packages/trpc/package.json"),
				),
			]);

			expect(auth).toContain(
				'import { prismaAdapter } from "better-auth/adapters/prisma";',
			);
			expect(auth).toContain(
				'database: prismaAdapter(db, { provider: "postgresql" }),',
			);
			expect(auth).not.toContain("drizzleAdapter");

			expect(nextConfig).toContain('"@acme/db"');
			expect(gitignore).toContain("packages/db/src/generated/");
			expect(workspaceYaml).toContain('"@prisma/engines": true');
			expect(workspaceYaml).toContain("prisma: true");

			const installs = manifest.installs.map((entry) => entry.definitionId);
			expect(installs).toContain("prisma");
			expect(installs).toContain("better-auth");
			expect(installs).not.toContain("drizzle");

			expect(rootPackageJson.scripts).toMatchObject({
				postinstall: "pnpm --filter @acme/db run generate",
			});
			expect(web.scripts).toMatchObject({
				"db:generate": "pnpm --filter @acme/db run generate",
				"db:migrate": "pnpm --filter @acme/db run migrate",
			});
			expect(web.dependencies).toHaveProperty("@acme/db");
			expect(trpc.dependencies).toHaveProperty("@acme/db");
		});
	}, 240_000);

	it("generates a neon adapter client for neon", async () => {
		await withScenarioWorkspace("prisma-neon", async (workspace) => {
			const db = await createPrismaProject(workspace, {
				databaseProvider: "neon",
			});

			expect(db.client).toContain(
				'import { PrismaNeon } from "@prisma/adapter-neon";',
			);
			expect(db.client).toContain(
				"const adapter = new PrismaNeon({ connectionString: env.DATABASE_URL });",
			);

			expect(db.packageJson.dependencies).toHaveProperty(
				"@prisma/adapter-neon",
			);
			expect(db.packageJson.dependencies).not.toHaveProperty(
				"@prisma/adapter-pg",
			);

			expect(db.env).toContain(
				'DATABASE_URL="postgresql://user:password@ep-example-123456-pooler.us-east-2.aws.neon.tech/database?sslmode=require&channel_binding=require"',
			);
		});
	}, 120_000);

	it("generates a pg adapter client with provider env examples for prisma postgres", async () => {
		await withScenarioWorkspace("prisma-postgres", async (workspace) => {
			const db = await createPrismaProject(workspace, {
				databaseProvider: "prisma-postgres",
			});

			expect(db.client).toContain(
				'import { PrismaPg } from "@prisma/adapter-pg";',
			);
			expect(db.packageJson.dependencies).toHaveProperty("@prisma/adapter-pg");

			expect(db.env).toContain(
				'DATABASE_URL="postgres://user:password@pooled.db.prisma.io:5432/?sslmode=require"',
			);
			expect(db.env).toContain(
				'DATABASE_DIRECT_URL="postgres://user:password@db.prisma.io:5432/?sslmode=require"',
			);
			expect(db.envExample).toContain("pooled.db.prisma.io:5432");
		});
	}, 120_000);

	it("generates a libsql adapter client and scratch migration file for turso", async () => {
		await withScenarioWorkspace("prisma-turso", async (workspace) => {
			const db = await createPrismaProject(workspace, {
				database: "sqlite",
				databaseProvider: "turso",
			});

			expect(db.client).toBe(
				`import { env } from "@acme/db/env";
import { PrismaClient } from "@acme/db/generated/prisma/client";
import { PrismaLibSql } from "@prisma/adapter-libsql";

const adapter = new PrismaLibSql({
  url: env.TURSO_DATABASE_URL,
  authToken: env.TURSO_AUTH_TOKEN,
});

export const db = new PrismaClient({ adapter });
`,
			);

			expect(db.schema).toContain('provider = "sqlite"');
			expect(db.schema).not.toContain("relationMode");
			expect(db.schema).not.toContain("@db.Timestamptz");

			expect(db.prismaConfig).toContain(
				'fileURLToPath(new URL("prisma/local.db", import.meta.url))',
			);
			expect(db.prismaConfig).toContain("turso db shell");

			expect(db.packageJson.dependencies).toHaveProperty(
				"@prisma/adapter-libsql",
			);
			expect(db.packageJson.dependencies).not.toHaveProperty(
				"@prisma/adapter-pg",
			);

			expect(db.env).toContain(
				'TURSO_DATABASE_URL="libsql://database-name-org.aws-us-east-1.turso.io"',
			);
			expect(db.env).toContain('TURSO_AUTH_TOKEN="change-me"');

			expect(db.dbEnv).toContain(`  server: {
    TURSO_DATABASE_URL: z.url(),
    TURSO_AUTH_TOKEN: z.string(),
  },`);

			const gitignore = await readFile(
				join(workspace.projectRoot, ".gitignore"),
				"utf-8",
			);
			expect(gitignore).toContain("/packages/db/prisma/local.db*");
		});
	}, 120_000);

	it("generates a planetscale adapter client with emulated relations for planetscale mysql", async () => {
		await withScenarioWorkspace(
			"prisma-planetscale-mysql",
			async (workspace) => {
				const db = await createPrismaProject(workspace, {
					authentication: "better-auth",
					database: "mysql",
					databaseProvider: "planetscale",
				});

				expect(db.client).toContain(
					'import { PrismaPlanetScale } from "@prisma/adapter-planetscale";',
				);
				expect(db.client).toContain(
					"const adapter = new PrismaPlanetScale({ url: env.DATABASE_URL });",
				);

				expect(db.schema).toContain('provider = "mysql"');
				expect(db.schema).toContain('relationMode = "prisma"');
				expect(db.schema).toContain("@@index([userId])");
				expect(db.schema).toContain(
					'ipAddress String?  @map("ip_address") @db.Text',
				);
				expect(db.schema).not.toContain("@db.Timestamptz");

				expect(db.prismaConfig).toContain("process.env.DATABASE_URL");
				expect(db.prismaConfig).not.toContain("DATABASE_DIRECT_URL");

				expect(db.packageJson.dependencies).toHaveProperty(
					"@prisma/adapter-planetscale",
				);

				expect(db.env).toContain(
					'DATABASE_URL="mysql://user:password@aws.connect.psdb.cloud/database?sslaccept=strict"',
				);

				const auth = await readFile(
					join(workspace.projectRoot, "packages/auth/src/index.ts"),
					"utf-8",
				);
				expect(auth).toContain(
					'database: prismaAdapter(db, { provider: "mysql" }),',
				);
			},
		);
	}, 120_000);

	it("generates a better-sqlite3 adapter client for local sqlite", async () => {
		await withScenarioWorkspace("prisma-sqlite", async (workspace) => {
			const db = await createPrismaProject(workspace, {
				database: "sqlite",
			});

			expect(db.client).toContain(
				'import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";',
			);
			expect(db.client).toContain(
				"const adapter = new PrismaBetterSqlite3({ url: env.DATABASE_URL });",
			);

			expect(db.schema).toContain('provider = "sqlite"');
			expect(db.prismaConfig).toContain(
				'fileURLToPath(new URL("../../local.db", import.meta.url))',
			);

			expect(db.packageJson.dependencies).toHaveProperty(
				"@prisma/adapter-better-sqlite3",
			);
			expect(db.packageJson.devDependencies).toHaveProperty(
				"@types/better-sqlite3",
			);

			expect(db.env).toContain('DATABASE_URL="file:../../local.db"');

			const [gitignore, workspaceYaml] = await Promise.all([
				readFile(join(workspace.projectRoot, ".gitignore"), "utf-8"),
				readFile(join(workspace.projectRoot, "pnpm-workspace.yaml"), "utf-8"),
			]);
			expect(gitignore).toContain("/local.db*");
			expect(workspaceYaml).toContain("better-sqlite3: true");
		});
	}, 120_000);

	it("generates a mariadb adapter client for local mysql", async () => {
		await withScenarioWorkspace("prisma-mysql", async (workspace) => {
			const db = await createPrismaProject(workspace, {
				database: "mysql",
			});

			expect(db.client).toContain(
				'import { PrismaMariaDb } from "@prisma/adapter-mariadb";',
			);
			expect(db.client).toContain("const adapter = new PrismaMariaDb({");

			expect(db.schema).toContain('provider = "mysql"');
			expect(db.schema).not.toContain("relationMode");
			expect(db.schema).toContain("name          String @db.Text");

			expect(db.packageJson.dependencies).toHaveProperty(
				"@prisma/adapter-mariadb",
			);

			expect(db.env).toContain(
				'DATABASE_URL="mysql://root:password@localhost:3306/app"',
			);

			const workspaceYaml = await readFile(
				join(workspace.projectRoot, "pnpm-workspace.yaml"),
				"utf-8",
			);
			expect(workspaceYaml).not.toContain("better-sqlite3: true");
		});
	}, 120_000);

	it("generates a schema without auth models when authentication is off", async () => {
		await withScenarioWorkspace("prisma-no-auth", async (workspace) => {
			const db = await createPrismaProject(workspace);

			expect(db.schema).toContain("model User {");
			expect(db.schema).not.toContain("model Session {");
			expect(db.schema).not.toContain("model Account {");
			expect(db.schema).not.toContain("sessions Session[]");
		});
	}, 120_000);
});
