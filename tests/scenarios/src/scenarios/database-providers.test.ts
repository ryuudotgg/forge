import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	createProject,
	readJson,
	type ScenarioProject,
	withScenarioWorkspace,
} from "../utils/harness";

interface DbPackageJson {
	readonly dependencies?: Record<string, string>;
	readonly devDependencies?: Record<string, string>;
}

interface GeneratedDbPackage {
	readonly client: string;
	readonly dbEnv: string;
	readonly drizzleConfig: string;
	readonly env: string;
	readonly envExample: string;
	readonly index: string;
	readonly packageJson: DbPackageJson;
}

async function createDatabaseProject(
	workspace: ScenarioProject,
	config?: Record<string, unknown>,
): Promise<GeneratedDbPackage> {
	await createProject(workspace, {
		database: "postgresql",
		linter: "biome",
		orm: "drizzle",
		packageManager: "pnpm",
		style: "tailwind",
		web: "nextjs",
		...config,
	});

	const readText = (path: string) =>
		readFile(join(workspace.projectRoot, path), "utf-8");

	const [client, dbEnv, drizzleConfig, env, envExample, index, packageJson] =
		await Promise.all([
			readText("packages/db/src/client.ts"),
			readText("packages/db/env.ts"),
			readText("packages/db/drizzle.config.ts"),
			readText(".env"),
			readText(".env.example"),
			readText("packages/db/src/index.ts"),
			readJson<DbPackageJson>(
				join(workspace.projectRoot, "packages/db/package.json"),
			),
		]);

	return { client, dbEnv, drizzleConfig, env, envExample, index, packageJson };
}

describe("database providers", () => {
	it("generates a neon-http client on the default endpoint for neon", async () => {
		await withScenarioWorkspace("db-provider-neon", async (workspace) => {
			const db = await createDatabaseProject(workspace, {
				databaseProvider: "neon",
			});

			expect(db.client).toBe(
				`import { env } from "@acme/db/env";
import { relations } from "@acme/db/relations";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";

const client = neon(env.DATABASE_URL);
export const db = drizzle({ client, relations });
`,
			);

			expect(db.index).toContain(
				'export type { NeonHttpDatabase } from "drizzle-orm/neon-http";',
			);
			expect(db.drizzleConfig).toContain('dialect: "postgresql"');
			expect(db.drizzleConfig).toContain(
				"dbCredentials: { url: env.DATABASE_DIRECT_URL },",
			);

			expect(db.packageJson.dependencies).toHaveProperty(
				"@neondatabase/serverless",
			);
			expect(db.packageJson.dependencies).not.toHaveProperty("pg");
			expect(db.packageJson.devDependencies).toHaveProperty("pg");
			expect(db.packageJson.devDependencies).toHaveProperty("@types/pg");

			expect(db.env).toContain(
				'DATABASE_URL="postgresql://user:password@ep-example-123456-pooler.us-east-2.aws.neon.tech/database?sslmode=require&channel_binding=require"',
			);
			expect(db.env).toContain(
				'DATABASE_DIRECT_URL="postgresql://user:password@ep-example-123456.us-east-2.aws.neon.tech/database?sslmode=require&channel_binding=require"',
			);
			expect(db.envExample).toContain(
				'DATABASE_URL="postgresql://user:password@ep-example-123456-pooler.us-east-2.aws.neon.tech/database?sslmode=require&channel_binding=require"',
			);
			expect(db.envExample).toContain(
				'DATABASE_DIRECT_URL="postgresql://user:password@ep-example-123456.us-east-2.aws.neon.tech/database?sslmode=require&channel_binding=require"',
			);
		});
	}, 120_000);

	it("generates a postgres-js client for supabase", async () => {
		await withScenarioWorkspace("db-provider-supabase", async (workspace) => {
			const db = await createDatabaseProject(workspace, {
				databaseProvider: "supabase",
			});

			expect(db.client).toContain(
				'import { drizzle } from "drizzle-orm/postgres-js";',
			);
			expect(db.client).toContain('import postgres from "postgres";');
			expect(db.client).toContain(
				"const client = postgres(env.DATABASE_URL, { prepare: false });",
			);

			expect(db.index).toContain(
				'export type { PostgresJsDatabase } from "drizzle-orm/postgres-js";',
			);

			expect(db.packageJson.dependencies).toHaveProperty("postgres");
			expect(db.packageJson.dependencies).not.toHaveProperty(
				"@neondatabase/serverless",
			);
			expect(db.packageJson.devDependencies).not.toHaveProperty("pg");

			expect(db.env).toContain(
				'DATABASE_URL="postgres://postgres.project-ref:password@aws-0-us-east-1.pooler.supabase.com:6543/postgres"',
			);
			expect(db.env).toContain(
				'DATABASE_DIRECT_URL="postgres://postgres.project-ref:password@aws-0-us-east-1.pooler.supabase.com:5432/postgres"',
			);
			expect(db.envExample).toContain(
				'DATABASE_URL="postgres://postgres.project-ref:password@aws-0-us-east-1.pooler.supabase.com:6543/postgres"',
			);
		});
	}, 120_000);

	it("generates a node-postgres client for local postgres when no provider is chosen", async () => {
		await withScenarioWorkspace("db-provider-none", async (workspace) => {
			const db = await createDatabaseProject(workspace);

			expect(db.client).toContain(
				'import { drizzle } from "drizzle-orm/node-postgres";',
			);
			expect(db.client).toContain('import { Pool } from "pg";');
			expect(db.client).toContain(
				"const client = new Pool({ connectionString: env.DATABASE_URL });",
			);

			expect(db.index).toContain(
				'export type { NodePgDatabase } from "drizzle-orm/node-postgres";',
			);

			expect(db.packageJson.dependencies).toHaveProperty("pg");
			expect(db.packageJson.dependencies).not.toHaveProperty(
				"@neondatabase/serverless",
			);
			expect(db.packageJson.dependencies).not.toHaveProperty("postgres");
			expect(db.packageJson.devDependencies).toHaveProperty("@types/pg");

			expect(db.env).toContain(
				'DATABASE_URL="postgresql://user:password@localhost:5432/postgres?sslmode=disable"',
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
		});
	}, 120_000);

	it("generates a node-postgres client with provider env examples for nile", async () => {
		await withScenarioWorkspace("db-provider-nile", async (workspace) => {
			const db = await createDatabaseProject(workspace, {
				databaseProvider: "nile",
			});

			expect(db.client).toContain(
				'import { drizzle } from "drizzle-orm/node-postgres";',
			);
			expect(db.packageJson.dependencies).toHaveProperty("pg");
			expect(db.env).toContain(
				'DATABASE_URL="postgres://user:password@db.thenile.dev:5432/database"',
			);
			expect(db.env).toContain(
				'DATABASE_DIRECT_URL="postgres://user:password@db.thenile.dev:5432/database"',
			);
			expect(db.envExample).toContain(
				'DATABASE_URL="postgres://user:password@db.thenile.dev:5432/database"',
			);
			expect(db.envExample).toContain(
				'DATABASE_DIRECT_URL="postgres://user:password@db.thenile.dev:5432/database"',
			);
		});
	}, 120_000);

	it("keeps drizzle on a node-postgres client when the config picks prisma postgres", async () => {
		await withScenarioWorkspace(
			"db-provider-prisma-postgres",
			async (workspace) => {
				const db = await createDatabaseProject(workspace, {
					databaseProvider: "prisma-postgres",
				});

				expect(db.client).toContain(
					'import { drizzle } from "drizzle-orm/node-postgres";',
				);
				expect(db.client).toContain('import { Pool } from "pg";');
				expect(db.client).toContain(
					"const client = new Pool({ connectionString: env.DATABASE_URL });",
				);

				expect(db.index).toContain(
					'export type { NodePgDatabase } from "drizzle-orm/node-postgres";',
				);
				expect(db.drizzleConfig).toContain('dialect: "postgresql"');
				expect(db.drizzleConfig).toContain(
					"dbCredentials: { url: env.DATABASE_DIRECT_URL },",
				);

				expect(db.packageJson.dependencies).toHaveProperty("pg");
				expect(db.packageJson.dependencies).not.toHaveProperty(
					"@neondatabase/serverless",
				);

				expect(db.env).toContain(
					'DATABASE_URL="postgres://user:password@pooled.db.prisma.io:5432/?sslmode=require"',
				);
				expect(db.env).toContain(
					'DATABASE_DIRECT_URL="postgres://user:password@db.prisma.io:5432/?sslmode=require"',
				);

				const schemaIndex = await readFile(
					join(workspace.projectRoot, "packages/db/src/schema/index.ts"),
					"utf-8",
				);
				expect(schemaIndex).not.toContain('export * from "./auth";');
			},
		);
	}, 120_000);

	it("generates a neon-http client on the planetscale endpoint for planetscale", async () => {
		await withScenarioWorkspace(
			"db-provider-planetscale",
			async (workspace) => {
				const db = await createDatabaseProject(workspace, {
					databaseProvider: "planetscale",
				});

				expect(db.client).toContain(
					'import { drizzle } from "drizzle-orm/neon-http";',
				);
				expect(db.client).toContain(
					"neonConfig.fetchEndpoint = (host) => `https://${host}/sql`;",
				);

				expect(db.index).toContain(
					'export type { NeonHttpDatabase } from "drizzle-orm/neon-http";',
				);

				expect(db.packageJson.dependencies).toHaveProperty(
					"@neondatabase/serverless",
				);
				expect(db.packageJson.dependencies).not.toHaveProperty("pg");
				expect(db.packageJson.devDependencies).toHaveProperty("pg");

				expect(db.env).toContain(
					'DATABASE_URL="postgresql://user:password@host.psdb.cloud:6432/postgres?sslmode=verify-full"',
				);
				expect(db.env).toContain(
					'DATABASE_DIRECT_URL="postgresql://user:password@host.psdb.cloud:5432/postgres?sslmode=verify-full"',
				);
			},
		);
	}, 120_000);

	it("generates a libsql client and sqlite auth schema for turso", async () => {
		await withScenarioWorkspace("db-provider-turso", async (workspace) => {
			const db = await createDatabaseProject(workspace, {
				authentication: "better-auth",
				database: "sqlite",
				databaseProvider: "turso",
			});

			expect(db.client).toBe(
				`import { env } from "@acme/db/env";
import { relations } from "@acme/db/relations";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";

const client = createClient({
  url: env.TURSO_DATABASE_URL,
  authToken: env.TURSO_AUTH_TOKEN,
});

export const db = drizzle({ client, relations });
`,
			);

			expect(db.index).toContain(
				'export type { LibSQLDatabase } from "drizzle-orm/libsql";',
			);
			expect(db.drizzleConfig).toContain('dialect: "turso"');
			expect(db.drizzleConfig).toContain(
				"dbCredentials: { url: env.TURSO_DATABASE_URL, authToken: env.TURSO_AUTH_TOKEN },",
			);

			expect(db.packageJson.dependencies).toHaveProperty("@libsql/client");
			expect(db.packageJson.dependencies).not.toHaveProperty("pg");
			expect(db.packageJson.devDependencies).not.toHaveProperty("pg");

			expect(db.env).toContain(
				'TURSO_DATABASE_URL="libsql://database-name-org.aws-us-east-1.turso.io"',
			);
			expect(db.env).toContain('TURSO_AUTH_TOKEN="change-me"');
			expect(db.env).not.toMatch(/^DATABASE_URL=/m);
			expect(db.envExample).toContain('TURSO_AUTH_TOKEN=""');

			expect(db.dbEnv).toContain(`  server: {
    TURSO_DATABASE_URL: z.url(),
    TURSO_AUTH_TOKEN: z.string(),
  },`);
			expect(db.dbEnv).toContain(`  runtimeEnvStrict: {
    NODE_ENV: process.env.NODE_ENV,
    TURSO_DATABASE_URL: process.env.TURSO_DATABASE_URL,
    TURSO_AUTH_TOKEN: process.env.TURSO_AUTH_TOKEN,
  },`);

			const readText = (path: string) =>
				readFile(join(workspace.projectRoot, path), "utf-8");

			const [users, authSchema, schemaIndex, auth] = await Promise.all([
				readText("packages/db/src/schema/users/users.ts"),
				readText("packages/db/src/schema/auth.ts"),
				readText("packages/db/src/schema/index.ts"),
				readText("packages/auth/src/index.ts"),
			]);

			expect(users).toContain(
				'import { integer, snakeCase, text } from "drizzle-orm/sqlite-core";',
			);
			expect(users).toContain(
				'emailVerified: integer({ mode: "boolean" }).notNull().default(false),',
			);
			expect(users).toContain(
				"const unixepochMs = sql`(cast(unixepoch('subsecond') * 1000 as integer))`;",
			);

			expect(authSchema).toContain(
				'export const sessions = snakeCase.table(\n  "sessions",',
			);
			expect(authSchema).toContain('integer({ mode: "timestamp_ms" })');
			expect(authSchema).toContain(
				'.references(() => users.id, { onDelete: "cascade" })',
			);
			expect(authSchema).toContain("sessions_user_id_idx");
			expect(authSchema).toContain("accounts_user_id_idx");

			expect(schemaIndex).toContain('export * from "./auth";');

			expect(auth).toContain('provider: "sqlite",');
		});
	}, 120_000);

	it("generates a libsql file client for local sqlite when no provider is chosen", async () => {
		await withScenarioWorkspace("db-provider-sqlite", async (workspace) => {
			const db = await createDatabaseProject(workspace, {
				database: "sqlite",
			});

			expect(db.client).toContain(
				"const client = createClient({ url: env.DATABASE_URL });",
			);
			expect(db.client).toContain(
				'import { drizzle } from "drizzle-orm/libsql";',
			);

			expect(db.index).toContain(
				'export type { LibSQLDatabase } from "drizzle-orm/libsql";',
			);
			expect(db.drizzleConfig).toContain('dialect: "sqlite"');
			expect(db.drizzleConfig).toContain(
				"dbCredentials: { url: env.DATABASE_URL },",
			);

			expect(db.packageJson.dependencies).toHaveProperty("@libsql/client");

			expect(db.env).toContain('DATABASE_URL="file:../../local.db"');
			expect(db.env).not.toContain("DATABASE_DIRECT_URL=");

			// The file path is not a parseable URL, so it validates as a string.
			expect(db.dbEnv).toContain(`  server: {
    DATABASE_URL: z.string(),
  },`);

			const gitignore = await readFile(
				join(workspace.projectRoot, ".gitignore"),
				"utf-8",
			);
			expect(gitignore).toContain("/local.db*");
		});
	}, 120_000);

	it("generates a planetscale serverless client and unenforced mysql auth schema for planetscale mysql", async () => {
		await withScenarioWorkspace(
			"db-provider-planetscale-mysql",
			async (workspace) => {
				const db = await createDatabaseProject(workspace, {
					authentication: "better-auth",
					database: "mysql",
					databaseProvider: "planetscale",
				});

				expect(db.client).toContain(
					'import { Client } from "@planetscale/database";',
				);
				expect(db.client).toContain(
					'import { drizzle } from "drizzle-orm/planetscale-serverless";',
				);
				expect(db.client).toContain(
					"const client = new Client({ url: env.DATABASE_URL });",
				);

				expect(db.index).toContain(
					'export type { PlanetScaleDatabase } from "drizzle-orm/planetscale-serverless";',
				);
				expect(db.drizzleConfig).toContain('dialect: "mysql"');

				expect(db.packageJson.dependencies).toHaveProperty(
					"@planetscale/database",
				);
				expect(db.packageJson.dependencies).not.toHaveProperty("mysql2");
				expect(db.packageJson.devDependencies).toHaveProperty("mysql2");

				expect(db.env).toContain(
					`DATABASE_URL='mysql://user:password@aws.connect.psdb.cloud/database?ssl={"rejectUnauthorized":true}'`,
				);

				const readText = (path: string) =>
					readFile(join(workspace.projectRoot, path), "utf-8");

				const [users, authSchema, auth] = await Promise.all([
					readText("packages/db/src/schema/users/users.ts"),
					readText("packages/db/src/schema/auth.ts"),
					readText("packages/auth/src/index.ts"),
				]);

				expect(users).toContain("export const users = snakeCase.table(");
				expect(users).toContain("id: varchar({ length: 36 }).primaryKey(),");
				expect(users).toContain(
					"email: varchar({ length: 255 }).notNull().unique(),",
				);
				expect(users).toContain(
					"createdAt: timestamp({ fsp: 3 }).notNull().defaultNow(),",
				);

				expect(authSchema).not.toContain(".references(");
				expect(authSchema).toContain(
					'index("sessions_user_id_idx").on(table.userId)',
				);
				expect(authSchema).toContain(
					'index("accounts_user_id_idx").on(table.userId)',
				);

				expect(auth).toContain('provider: "mysql",');
			},
		);
	}, 120_000);

	it("generates a mysql2 client with enforced references for local mysql", async () => {
		await withScenarioWorkspace("db-provider-mysql", async (workspace) => {
			const db = await createDatabaseProject(workspace, {
				authentication: "better-auth",
				database: "mysql",
			});

			expect(db.client).toContain(
				'import { drizzle } from "drizzle-orm/mysql2";',
			);
			expect(db.client).toContain(
				'import { createPool } from "mysql2/promise";',
			);
			expect(db.client).toContain(
				'const client = createPool({ uri: env.DATABASE_URL, timezone: "Z" });',
			);
			expect(db.client).toContain(
				"export const db = drizzle({ client, relations });",
			);

			expect(db.index).toContain(
				'export type { MySql2Database } from "drizzle-orm/mysql2";',
			);
			expect(db.drizzleConfig).toContain('dialect: "mysql"');

			expect(db.packageJson.dependencies).toHaveProperty("mysql2");
			expect(db.packageJson.dependencies).not.toHaveProperty(
				"@planetscale/database",
			);

			expect(db.env).toContain(
				'DATABASE_URL="mysql://root:password@localhost:3306/app"',
			);

			const authSchema = await readFile(
				join(workspace.projectRoot, "packages/db/src/schema/auth.ts"),
				"utf-8",
			);
			expect(authSchema).toContain(
				'.references(() => users.id, { onDelete: "cascade" })',
			);
			expect(authSchema).not.toContain("index(");
		});
	}, 120_000);
});
