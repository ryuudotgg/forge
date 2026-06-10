import { describe, expect, it } from "vitest";
import {
	detectDatabaseProvider,
	localPostgres,
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
			resolveDatabaseProvider({ databaseProvider: "prisma-postgres" }),
		).toBe(localPostgres);
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

	it("detects supabase from postgres-js", () => {
		expect(
			detectDatabaseProvider({ dependencies: { postgres: "^3.4.9" } }),
		).toBe("supabase");
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
});
