import { describe, expect, it } from "vitest";
import {
	detectDatabaseProvider,
	localPostgres,
	postgresProviderIdsFor,
	resolveDatabaseProvider,
} from "../src/index";

describe("resolveDatabaseProvider", () => {
	it("falls back to local postgres without a provider", () => {
		expect(resolveDatabaseProvider({})).toBe(localPostgres);
		expect(resolveDatabaseProvider({ database: "postgresql" })).toBe(
			localPostgres,
		);
	});

	it("falls back to local postgres for providers outside the postgres matrix", () => {
		expect(resolveDatabaseProvider({ databaseProvider: "turso" })).toBe(
			localPostgres,
		);
		expect(
			resolveDatabaseProvider({
				database: "mysql",
				databaseProvider: "planetscale",
			}),
		).toBe(localPostgres);
	});

	it("resolves the postgres profiles by provider", () => {
		expect(
			resolveDatabaseProvider({ databaseProvider: "neon" }).drizzle.driver,
		).toBe("neon-http");
		expect(
			resolveDatabaseProvider({ databaseProvider: "supabase" }).drizzle.driver,
		).toBe("postgres-js");
		expect(
			resolveDatabaseProvider({ databaseProvider: "nile" }).drizzle.driver,
		).toBe("node-postgres");
		expect(
			resolveDatabaseProvider({
				database: "postgresql",
				databaseProvider: "planetscale",
			}).drizzle,
		).toMatchObject({ clientTemplate: "planetscale", driver: "neon-http" });
	});

	it("resolves the prisma adapter by provider", () => {
		expect(
			resolveDatabaseProvider({ databaseProvider: "neon" }).prisma,
		).toMatchObject({
			clientTemplate: "neon",
			runtimeDeps: ["prismaAdapterNeon"],
		});

		for (const databaseProvider of [
			"planetscale",
			"nile",
			"supabase",
			"prisma-postgres",
		] as const)
			expect(
				resolveDatabaseProvider({ databaseProvider }).prisma,
			).toMatchObject({
				clientTemplate: "pg",
				runtimeDeps: ["prismaAdapterPg"],
			});

		expect(resolveDatabaseProvider({}).prisma.clientTemplate).toBe("pg");
	});

	it("resolves prisma postgres with plain postgres support for both orms", () => {
		const profile = resolveDatabaseProvider({
			databaseProvider: "prisma-postgres",
		});

		expect(profile.dialect).toBe("postgresql");
		expect(profile.drizzle.driver).toBe("node-postgres");
		expect(profile.envVars.map(({ value }) => value)).toEqual([
			"postgres://user:password@pooled.db.prisma.io:5432/?sslmode=require",
			"postgres://user:password@db.prisma.io:5432/?sslmode=require",
		]);
	});
});

describe("postgresProviderIdsFor", () => {
	it("only offers prisma postgres alongside the prisma orm", () => {
		expect(postgresProviderIdsFor("prisma")).toContain("prisma-postgres");
		expect(postgresProviderIdsFor("drizzle")).not.toContain("prisma-postgres");
		expect(postgresProviderIdsFor(undefined)).not.toContain("prisma-postgres");
	});
});

describe("detectDatabaseProvider", () => {
	const neonDeps = { "@neondatabase/serverless": "^1.0.2" };

	it("detects neon from the serverless driver", () => {
		expect(detectDatabaseProvider({ dependencies: neonDeps })).toBe("neon");
	});

	it("detects planetscale from the fetch endpoint override", () => {
		expect(
			detectDatabaseProvider({
				dependencies: neonDeps,
				clientSource:
					"neonConfig.fetchEndpoint = (host) => `https://${host}/sql`;",
			}),
		).toBe("planetscale");
	});

	it("detects supabase from postgres-js and a supabase host", () => {
		expect(
			detectDatabaseProvider({
				dependencies: { postgres: "^3.4.9" },
				databaseUrl:
					"postgres://postgres.project-ref:password@aws-0-us-east-1.pooler.supabase.com:6543/postgres",
			}),
		).toBe("supabase");
	});

	it("stays undetected for postgres-js against a non-supabase host", () => {
		expect(
			detectDatabaseProvider({
				dependencies: { postgres: "^3.4.9" },
				databaseUrl: "postgres://user:password@db.example.com:5432/database",
			}),
		).toBeUndefined();
	});

	it("detects nile from the connection string", () => {
		expect(
			detectDatabaseProvider({
				dependencies: { pg: "^8.21.0" },
				databaseUrl: "postgres://user:password@db.thenile.dev:5432/database",
			}),
		).toBe("nile");
	});

	it("stays undetected for plain postgres", () => {
		expect(
			detectDatabaseProvider({
				dependencies: { pg: "^8.21.0" },
				databaseUrl:
					"postgresql://user:password@localhost:5432/postgres?sslmode=disable",
			}),
		).toBeUndefined();
	});

	it("detects neon from the prisma adapter", () => {
		expect(
			detectDatabaseProvider({
				dependencies: { "@prisma/adapter-neon": "^7.8.0" },
			}),
		).toBe("neon");
	});

	it("detects pg-adapter providers from the connection string", () => {
		const dependencies = { "@prisma/adapter-pg": "^7.8.0" };

		expect(
			detectDatabaseProvider({
				dependencies,
				databaseUrl:
					"postgresql://user:password@host.psdb.cloud:6432/postgres?sslmode=verify-full",
			}),
		).toBe("planetscale");
		expect(
			detectDatabaseProvider({
				dependencies,
				databaseUrl:
					"postgres://postgres.project-ref:password@aws-0-us-east-1.pooler.supabase.com:6543/postgres",
			}),
		).toBe("supabase");
		expect(
			detectDatabaseProvider({
				dependencies,
				databaseUrl:
					"postgres://user:password@pooled.db.prisma.io:5432/?sslmode=require",
			}),
		).toBe("prisma-postgres");
		expect(
			detectDatabaseProvider({
				dependencies,
				databaseUrl: "postgres://user:password@db.thenile.dev:5432/database",
			}),
		).toBe("nile");
	});

	it("stays undetected for the pg adapter against an unknown host", () => {
		expect(
			detectDatabaseProvider({
				dependencies: { "@prisma/adapter-pg": "^7.8.0" },
				databaseUrl:
					"postgresql://user:password@localhost:5432/postgres?sslmode=disable",
			}),
		).toBeUndefined();
	});

	it("only matches provider hosts on domain boundaries", () => {
		const dependencies = { "@prisma/adapter-pg": "^7.8.0" };

		expect(
			detectDatabaseProvider({
				dependencies,
				databaseUrl: "postgres://user:password@db.prisma.io.evil.example/",
			}),
		).toBeUndefined();
		expect(
			detectDatabaseProvider({
				dependencies,
				databaseUrl: "postgres://user:password@evil.example/db.prisma.io",
			}),
		).toBeUndefined();
		expect(
			detectDatabaseProvider({
				dependencies,
				databaseUrl: "postgres://db.thenile.dev@evil.example/database",
			}),
		).toBeUndefined();
		expect(
			detectDatabaseProvider({
				dependencies,
				databaseUrl:
					"postgres://user:password@pooler.supabase.com.evil.example/",
			}),
		).toBeUndefined();
		expect(
			detectDatabaseProvider({ dependencies, databaseUrl: "not a url" }),
		).toBeUndefined();
	});
});
