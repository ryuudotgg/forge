import type { Database, DatabaseProvider, ForgeConfig, Orm } from "../config";
import type { VersionKey } from "../versions";

export interface ProviderEnvVar {
	readonly name: string;
	readonly value: string;
	readonly example: string;
}

export type DrizzleDriver = "neon-http" | "node-postgres" | "postgres-js";

export type DrizzleClientTemplate = DrizzleDriver | "planetscale";

export interface DrizzleSupport {
	readonly clientTemplate: DrizzleClientTemplate;
	readonly driver: DrizzleDriver;
	readonly databaseType: string;
	readonly kitDialect: "postgresql";
	readonly runtimeDeps: ReadonlyArray<VersionKey>;
	readonly devDeps: ReadonlyArray<VersionKey>;
}

export type PrismaClientTemplate = "neon" | "pg";

export interface PrismaSupport {
	readonly clientTemplate: PrismaClientTemplate;
	readonly datasourceProvider: "postgresql";
	readonly runtimeDeps: ReadonlyArray<VersionKey>;
}

export interface DatabaseProviderProfile {
	readonly dialect: Database;
	readonly envVars: ReadonlyArray<ProviderEnvVar>;
	readonly drizzle: DrizzleSupport;
	readonly prisma: PrismaSupport;
}

interface PostgresUrls {
	readonly url: string;
	readonly urlExample?: string;
	readonly directUrl: string;
	readonly directUrlExample?: string;
}

function postgresEnvVars(urls: PostgresUrls): ReadonlyArray<ProviderEnvVar> {
	return [
		{
			name: "DATABASE_URL",
			value: urls.url,
			example: urls.urlExample ?? urls.url,
		},
		{
			name: "DATABASE_DIRECT_URL",
			value: urls.directUrl,
			example: urls.directUrlExample ?? urls.directUrl,
		},
	];
}

const neonHttp = {
	clientTemplate: "neon-http",
	driver: "neon-http",
	databaseType: "NeonHttpDatabase",
	kitDialect: "postgresql",
	runtimeDeps: ["neonServerless"],
	devDeps: ["pg", "typesPg"],
} as const satisfies DrizzleSupport;

// PlanetScale Postgres reuses the Neon serverless driver, but serves the
// HTTP protocol on the database host itself instead of Neon's API gateway.
const planetscaleHttp = {
	clientTemplate: "planetscale",
	driver: "neon-http",
	databaseType: "NeonHttpDatabase",
	kitDialect: "postgresql",
	runtimeDeps: ["neonServerless"],
	devDeps: ["pg", "typesPg"],
} as const satisfies DrizzleSupport;

const nodePostgres = {
	clientTemplate: "node-postgres",
	driver: "node-postgres",
	databaseType: "NodePgDatabase",
	kitDialect: "postgresql",
	runtimeDeps: ["pg"],
	devDeps: ["typesPg"],
} as const satisfies DrizzleSupport;

const postgresJs = {
	clientTemplate: "postgres-js",
	driver: "postgres-js",
	databaseType: "PostgresJsDatabase",
	kitDialect: "postgresql",
	runtimeDeps: ["postgres"],
	devDeps: [],
} as const satisfies DrizzleSupport;

const prismaNeon = {
	clientTemplate: "neon",
	datasourceProvider: "postgresql",
	runtimeDeps: ["prismaAdapterNeon"],
} as const satisfies PrismaSupport;

const prismaPg = {
	clientTemplate: "pg",
	datasourceProvider: "postgresql",
	runtimeDeps: ["prismaAdapterPg"],
} as const satisfies PrismaSupport;

export const localPostgres: DatabaseProviderProfile = {
	dialect: "postgresql",
	envVars: postgresEnvVars({
		url: "postgresql://user:password@localhost:5432/postgres?sslmode=disable",
		urlExample: "postgresql://user:password@host:5432/database?sslmode=require",
		directUrl:
			"postgresql://user:password@localhost:5432/postgres?sslmode=disable",
		directUrlExample:
			"postgresql://user:password@host:5432/database?sslmode=require",
	}),
	drizzle: nodePostgres,
	prisma: prismaPg,
};

export const postgresProviderIds = [
	"planetscale",
	"neon",
	"nile",
	"supabase",
] as const satisfies ReadonlyArray<DatabaseProvider>;

// Prisma Postgres serves the plain postgres protocol, so drizzle could talk
// to it too, but the prompt only offers it alongside the Prisma ORM.
export function postgresProviderIdsFor(
	orm: Orm | undefined,
): ReadonlyArray<DatabaseProvider> {
	return orm === "prisma"
		? [...postgresProviderIds, "prisma-postgres"]
		: postgresProviderIds;
}

const postgresProfiles: Record<
	(typeof postgresProviderIds)[number] | "prisma-postgres",
	DatabaseProviderProfile
> = {
	planetscale: {
		dialect: "postgresql",
		envVars: postgresEnvVars({
			url: "postgresql://user:password@host.psdb.cloud:6432/postgres?sslmode=verify-full",
			directUrl:
				"postgresql://user:password@host.psdb.cloud:5432/postgres?sslmode=verify-full",
		}),
		drizzle: planetscaleHttp,
		prisma: prismaPg,
	},
	neon: {
		dialect: "postgresql",
		envVars: postgresEnvVars({
			url: "postgresql://user:password@ep-example-123456-pooler.us-east-2.aws.neon.tech/database?sslmode=require&channel_binding=require",
			directUrl:
				"postgresql://user:password@ep-example-123456.us-east-2.aws.neon.tech/database?sslmode=require&channel_binding=require",
		}),
		drizzle: neonHttp,
		prisma: prismaNeon,
	},
	nile: {
		dialect: "postgresql",
		envVars: postgresEnvVars({
			url: "postgres://user:password@db.thenile.dev:5432/database",
			directUrl: "postgres://user:password@db.thenile.dev:5432/database",
		}),
		drizzle: nodePostgres,
		prisma: prismaPg,
	},
	supabase: {
		dialect: "postgresql",
		envVars: postgresEnvVars({
			url: "postgres://postgres.project-ref:password@aws-0-us-east-1.pooler.supabase.com:6543/postgres",
			directUrl:
				"postgres://postgres.project-ref:password@aws-0-us-east-1.pooler.supabase.com:5432/postgres",
		}),
		drizzle: postgresJs,
		prisma: prismaPg,
	},
	"prisma-postgres": {
		dialect: "postgresql",
		envVars: postgresEnvVars({
			url: "postgres://user:password@pooled.db.prisma.io:5432/?sslmode=require",
			directUrl: "postgres://user:password@db.prisma.io:5432/?sslmode=require",
		}),
		drizzle: nodePostgres,
		prisma: prismaPg,
	},
};

const profilesByProvider: Partial<
	Record<DatabaseProvider, DatabaseProviderProfile>
> = postgresProfiles;

export function resolveDatabaseProvider(
	config: ForgeConfig,
): DatabaseProviderProfile {
	const provider = config.databaseProvider;
	if (provider === undefined) return localPostgres;

	const profile = profilesByProvider[provider];
	if (profile === undefined) return localPostgres;
	if (profile.dialect !== (config.database ?? profile.dialect))
		return localPostgres;

	return profile;
}

export interface DatabaseProviderEvidence {
	readonly dependencies: Record<string, string>;
	readonly clientSource?: string;
	readonly databaseUrl?: string;
}

export function detectDatabaseProvider(
	evidence: DatabaseProviderEvidence,
): DatabaseProvider | undefined {
	if ("@neondatabase/serverless" in evidence.dependencies)
		return evidence.clientSource?.includes("neonConfig.fetchEndpoint")
			? "planetscale"
			: "neon";

	if ("@prisma/adapter-neon" in evidence.dependencies) return "neon";

	// The pg adapter is shared by every plain-postgres provider, so only the
	// connection string can tell them apart.
	if ("@prisma/adapter-pg" in evidence.dependencies) {
		if (evidence.databaseUrl?.includes(".psdb.cloud")) return "planetscale";
		if (evidence.databaseUrl?.includes(".supabase.")) return "supabase";
		if (evidence.databaseUrl?.includes("db.prisma.io"))
			return "prisma-postgres";
	}

	// postgres-js is Supabase's documented driver but also a general-purpose
	// client, so a Supabase host has to confirm it.
	if (
		"postgres" in evidence.dependencies &&
		evidence.databaseUrl?.includes(".supabase.")
	)
		return "supabase";

	// Nile shares the pg driver with the local-postgres fallback, so only the
	// connection string can tell them apart.
	if (evidence.databaseUrl?.includes(".thenile.dev")) return "nile";

	return undefined;
}
