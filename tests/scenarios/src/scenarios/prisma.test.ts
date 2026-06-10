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

	const [client, env, envExample, index, packageJson, prismaConfig, schema] =
		await Promise.all([
			readText("packages/db/src/client.ts"),
			readText(".env"),
			readText(".env.example"),
			readText("packages/db/src/index.ts"),
			readJson<PackageJson>(
				join(workspace.projectRoot, "packages/db/package.json"),
			),
			readText("packages/db/prisma.config.ts"),
			readText("packages/db/prisma/schema.prisma"),
		]);

	return { client, env, envExample, index, packageJson, prismaConfig, schema };
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
