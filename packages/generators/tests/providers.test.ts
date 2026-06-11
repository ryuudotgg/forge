import { describe, expect, it } from "vitest";
import { envFileLine } from "../src/data/providers";
import {
	detectDatabase,
	detectDatabaseProvider,
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

	it("detects planetscale from the mysql driver and adapter", () => {
		expect(
			detectDatabaseProvider({
				dependencies: { "@planetscale/database": "^1.20.1" },
			}),
		).toBe("planetscale");
		expect(
			detectDatabaseProvider({
				dependencies: { "@prisma/adapter-planetscale": "^7.8.0" },
			}),
		).toBe("planetscale");
	});

	it("detects turso from the libsql prisma adapter", () => {
		expect(
			detectDatabaseProvider({
				dependencies: { "@prisma/adapter-libsql": "^7.8.0" },
			}),
		).toBe("turso");
	});

	it("tells turso and local sqlite apart through the libsql client wiring", () => {
		const dependencies = { "@libsql/client": "^0.17.3" };

		expect(
			detectDatabaseProvider({
				dependencies,
				clientSource: "createClient({ url: env.TURSO_DATABASE_URL })",
			}),
		).toBe("turso");
		expect(
			detectDatabaseProvider({
				dependencies,
				databaseUrl: "libsql://database-name-org.aws-us-east-1.turso.io",
			}),
		).toBe("turso");
		expect(
			detectDatabaseProvider({
				dependencies,
				clientSource: "createClient({ url: env.DATABASE_URL })",
				databaseUrl: "file:../../local.db",
			}),
		).toBeUndefined();
	});

	it("stays undetected for local mysql drivers", () => {
		expect(
			detectDatabaseProvider({
				dependencies: { mysql2: "^3.22.5" },
				databaseUrl: "mysql://root:password@localhost:3306/app",
			}),
		).toBeUndefined();
		expect(
			detectDatabaseProvider({
				dependencies: { "@prisma/adapter-mariadb": "^7.8.0" },
			}),
		).toBeUndefined();
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

	it("infers the dialect from driver and adapter dependencies", () => {
		expect(detectDatabase({ dependencies: { "@libsql/client": "*" } })).toBe(
			"sqlite",
		);
		expect(
			detectDatabase({ dependencies: { "@prisma/adapter-libsql": "*" } }),
		).toBe("sqlite");
		expect(
			detectDatabase({
				dependencies: { "@prisma/adapter-better-sqlite3": "*" },
			}),
		).toBe("sqlite");
		expect(
			detectDatabase({ dependencies: { "@planetscale/database": "*" } }),
		).toBe("mysql");
		expect(detectDatabase({ dependencies: { mysql2: "*" } })).toBe("mysql");
		expect(
			detectDatabase({ dependencies: { "@prisma/adapter-mariadb": "*" } }),
		).toBe("mysql");
		expect(detectDatabase({ dependencies: { pg: "*" } })).toBe("postgresql");
		expect(
			detectDatabase({ dependencies: { "@neondatabase/serverless": "*" } }),
		).toBe("postgresql");
		expect(detectDatabase({ dependencies: {} })).toBeUndefined();
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
