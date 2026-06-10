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
	readonly drizzleConfig: string;
	readonly env: string;
	readonly envExample: string;
	readonly index: string;
	readonly packageJson: DbPackageJson;
}

async function createDatabaseProject(
	workspace: ScenarioProject,
	databaseProvider?: string,
): Promise<GeneratedDbPackage> {
	await createProject(workspace, {
		database: "postgresql",
		linter: "biome",
		orm: "drizzle",
		packageManager: "pnpm",
		style: "tailwind",
		web: "nextjs",
		...(databaseProvider === undefined ? {} : { databaseProvider }),
	});

	const readText = (path: string) =>
		readFile(join(workspace.projectRoot, path), "utf-8");

	const [client, drizzleConfig, env, envExample, index, packageJson] =
		await Promise.all([
			readText("packages/db/src/client.ts"),
			readText("packages/db/drizzle.config.ts"),
			readText(".env"),
			readText(".env.example"),
			readText("packages/db/src/index.ts"),
			readJson<DbPackageJson>(
				join(workspace.projectRoot, "packages/db/package.json"),
			),
		]);

	return { client, drizzleConfig, env, envExample, index, packageJson };
}

describe("database providers", () => {
	it("generates a neon-http client on the default endpoint for neon", async () => {
		await withScenarioWorkspace("db-provider-neon", async (workspace) => {
			const db = await createDatabaseProject(workspace, "neon");

			expect(db.client).toBe(
				`import { env } from "@acme/db/env";
import { relations } from "@acme/db/relations";
import * as schema from "@acme/db/schema";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";

const client = neon(env.DATABASE_URL);

export const db = drizzle({ client, schema, relations, casing: "snake_case" });
`,
			);

			expect(db.index).toContain(
				'export type { NeonHttpDatabase } from "drizzle-orm/neon-http";',
			);
			expect(db.drizzleConfig).toContain('dialect: "postgresql"');

			expect(db.packageJson.dependencies).toHaveProperty(
				"@neondatabase/serverless",
			);
			expect(db.packageJson.dependencies).not.toHaveProperty("pg");
			expect(db.packageJson.devDependencies).toHaveProperty("pg");
			expect(db.packageJson.devDependencies).toHaveProperty("@types/pg");

			expect(db.env).toContain(
				'DATABASE_URL="postgresql://user:password@ep-example-123456-pooler.us-east-2.aws.neon.tech/database?sslmode=require&channel_binding=require"',
			);
			expect(db.envExample).toContain(
				'DATABASE_DIRECT_URL="postgresql://user:password@ep-example-123456.us-east-2.aws.neon.tech/database?sslmode=require&channel_binding=require"',
			);
		});
	}, 120_000);

	it("generates a postgres-js client for supabase", async () => {
		await withScenarioWorkspace("db-provider-supabase", async (workspace) => {
			const db = await createDatabaseProject(workspace, "supabase");

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
			expect(db.envExample).toContain("pooler.supabase.com:6543");
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
		});
	}, 120_000);

	it("generates a node-postgres client with provider env examples for nile", async () => {
		await withScenarioWorkspace("db-provider-nile", async (workspace) => {
			const db = await createDatabaseProject(workspace, "nile");

			expect(db.client).toContain(
				'import { drizzle } from "drizzle-orm/node-postgres";',
			);
			expect(db.packageJson.dependencies).toHaveProperty("pg");
			expect(db.env).toContain("db.thenile.dev:5432");
			expect(db.envExample).toContain("db.thenile.dev:5432");
		});
	}, 120_000);

	it("generates a neon-http client on the planetscale endpoint for planetscale", async () => {
		await withScenarioWorkspace(
			"db-provider-planetscale",
			async (workspace) => {
				const db = await createDatabaseProject(workspace, "planetscale");

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
});
