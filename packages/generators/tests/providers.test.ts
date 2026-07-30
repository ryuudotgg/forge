import { describe, expect, it } from "vitest";
import { envFileLine } from "../src/data/providers";
import {
	localMysql,
	localPostgres,
	localSqlite,
	postgresProviderIdsFor,
	resolveDatabaseProvider,
} from "../src/index";

describe("envFileLine", () => {
	it("wraps values in the first quote style they don't use", () => {
		expect(envFileLine("DATABASE_URL", "postgres://localhost/db")).toBe(
			'DATABASE_URL="postgres://localhost/db"',
		);
		expect(envFileLine("DATABASE_URL", 'ssl={"rejectUnauthorized":true}')).toBe(
			`DATABASE_URL='ssl={"rejectUnauthorized":true}'`,
		);
		expect(envFileLine("DATABASE_URL", `pass"word'`)).toBe(
			"DATABASE_URL=`pass\"word'`",
		);
	});

	it("refuses values that use all three quote styles", () => {
		expect(() => envFileLine("DATABASE_URL", "\"'`")).toThrow(
			"all three quote styles",
		);
	});
});

describe("resolveDatabaseProvider", () => {
	it("falls back to the dialect's local profile without a provider", () => {
		expect(resolveDatabaseProvider({})).toBe(localPostgres);
		expect(resolveDatabaseProvider({ database: "postgresql" })).toBe(
			localPostgres,
		);
		expect(resolveDatabaseProvider({ database: "mysql" })).toBe(localMysql);
		expect(resolveDatabaseProvider({ database: "sqlite" })).toBe(localSqlite);
	});

	it("falls back to the dialect's local profile for providers outside its matrix", () => {
		expect(resolveDatabaseProvider({ databaseProvider: "turso" })).toBe(
			localPostgres,
		);
		expect(
			resolveDatabaseProvider({ database: "sqlite", databaseProvider: "neon" }),
		).toBe(localSqlite);
		expect(
			resolveDatabaseProvider({ database: "mysql", databaseProvider: "turso" }),
		).toBe(localMysql);
	});

	it("resolves planetscale to a different profile per dialect", () => {
		const postgres = resolveDatabaseProvider({
			database: "postgresql",
			databaseProvider: "planetscale",
		});
		const mysql = resolveDatabaseProvider({
			database: "mysql",
			databaseProvider: "planetscale",
		});

		expect(postgres.dialect).toBe("postgresql");
		expect(postgres.drizzle.driver).toBe("neon-http");

		expect(mysql.dialect).toBe("mysql");
		expect(mysql.drizzle).toMatchObject({
			clientTemplate: "planetscale-serverless",
			driver: "planetscale-serverless",
			kitDialect: "mysql",
			runtimeDeps: ["planetscaleDatabase"],
		});
		expect(mysql.prisma).toMatchObject({
			clientTemplate: "planetscale",
			datasourceProvider: "mysql",
			relationMode: "prisma",
			runtimeDeps: ["prismaAdapterPlanetscale"],
		});
	});

	it("resolves turso for sqlite with the libsql driver and adapter", () => {
		const profile = resolveDatabaseProvider({
			database: "sqlite",
			databaseProvider: "turso",
		});

		expect(profile.dialect).toBe("sqlite");
		expect(profile.envVars.map(({ name }) => name)).toEqual([
			"TURSO_DATABASE_URL",
			"TURSO_AUTH_TOKEN",
		]);
		expect(profile.drizzle).toMatchObject({
			clientTemplate: "turso",
			driver: "libsql",
			kitDialect: "turso",
			runtimeDeps: ["libsqlClient"],
		});
		expect(profile.prisma).toMatchObject({
			clientTemplate: "libsql",
			datasourceProvider: "sqlite",
			runtimeDeps: ["prismaAdapterLibsql"],
		});
	});

	it("resolves the local mysql and sqlite fallbacks to file and server drivers", () => {
		expect(localMysql.drizzle).toMatchObject({
			clientTemplate: "mysql2",
			driver: "mysql2",
			kitDialect: "mysql",
		});
		expect(localMysql.prisma).toMatchObject({
			clientTemplate: "mariadb",
			datasourceProvider: "mysql",
		});

		expect(localSqlite.envVars.map(({ value }) => value)).toEqual([
			"file:../../local.db",
		]);
		expect(localSqlite.drizzle).toMatchObject({
			clientTemplate: "libsql",
			driver: "libsql",
			kitDialect: "sqlite",
		});
		expect(localSqlite.prisma).toMatchObject({
			clientTemplate: "better-sqlite3",
			datasourceProvider: "sqlite",
		});
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
