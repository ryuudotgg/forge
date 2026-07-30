import type { Database, DatabaseProvider, ForgeConfig, Orm } from "../config";
import type { VersionKey } from "../versions";

export interface ProviderEnvVar {
	readonly name: string;
	readonly value: string;
	readonly example: string;
	readonly format: "url" | "string";
}

export type DrizzleDriver =
	| "libsql"
	| "mysql2"
	| "neon-http"
	| "node-postgres"
	| "planetscale-serverless"
	| "postgres-js";

export type DrizzleClientTemplate = DrizzleDriver | "planetscale" | "turso";

export type DrizzleKitDialect = "mysql" | "postgresql" | "sqlite" | "turso";

export interface DrizzleSupport {
	readonly clientTemplate: DrizzleClientTemplate;
	readonly driver: DrizzleDriver;
	readonly databaseType: string;
	readonly kitDialect: DrizzleKitDialect;
	readonly kitCredentials: ReadonlyArray<readonly [string, string]>;
	readonly schemaTemplates: { readonly users: string; readonly auth: string };
	readonly runtimeDeps: ReadonlyArray<VersionKey>;
	readonly devDeps: ReadonlyArray<VersionKey>;
}

export type PrismaClientTemplate =
	| "better-sqlite3"
	| "libsql"
	| "mariadb"
	| "neon"
	| "pg"
	| "planetscale";

export type PrismaConfigTemplate =
	| "database-url"
	| "direct-url"
	| "local-file"
	| "turso";

export type PrismaDatasourceProvider = "mysql" | "postgresql" | "sqlite";

export interface PrismaSupport {
	readonly clientTemplate: PrismaClientTemplate;
	readonly configTemplate: PrismaConfigTemplate;
	readonly datasourceProvider: PrismaDatasourceProvider;
	readonly relationMode?: "prisma";
	readonly envVars?: ReadonlyArray<ProviderEnvVar>;
	readonly runtimeDeps: ReadonlyArray<VersionKey>;
	readonly devDeps: ReadonlyArray<VersionKey>;
}

export interface DatabaseProviderProfile {
	readonly dialect: Database;
	readonly envVars: ReadonlyArray<ProviderEnvVar>;
	readonly drizzle: DrizzleSupport;
	readonly prisma: PrismaSupport;
}

// Better Auth's drizzle adapter names the postgres dialect "pg".
const drizzleAdapterProviders = {
	mysql: "mysql",
	postgresql: "pg",
	sqlite: "sqlite",
} as const satisfies Record<Database, string>;

export function drizzleAdapterProvider(
	dialect: Database,
): (typeof drizzleAdapterProviders)[Database] {
	return drizzleAdapterProviders[dialect];
}

export function envServerLines(envVars: ReadonlyArray<ProviderEnvVar>): string {
	return envVars
		.map(
			({ name, format }) =>
				`    ${name}: ${format === "url" ? "z.url()" : "z.string()"},`,
		)
		.join("\n");
}

export function envRuntimeLines(
	envVars: ReadonlyArray<ProviderEnvVar>,
): string {
	return envVars
		.map(({ name }) => `    ${name}: process.env.${name},`)
		.join("\n");
}

// dotenv has no escaping inside quoted values, so a value has to be wrapped
// in a quote style it doesn't use itself.
export function envFileLine(name: string, value: string): string {
	const quote = ['"', "'", "`"].find((style) => !value.includes(style));
	if (quote === undefined)
		throw new Error(
			`The value of ${name} can't be written to .env because it uses all three quote styles dotenv supports.`,
		);

	return `${name}=${quote}${value}${quote}`;
}

export function drizzleKitCredentials(support: DrizzleSupport): string {
	return support.kitCredentials
		.map(([option, envVar]) => `${option}: env.${envVar}`)
		.join(", ");
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
			format: "url",
		},
		{
			name: "DATABASE_DIRECT_URL",
			value: urls.directUrl,
			example: urls.directUrlExample ?? urls.directUrl,
			format: "url",
		},
	];
}

function databaseUrlEnvVar(
	value: string,
	example: string = value,
): ProviderEnvVar {
	return { name: "DATABASE_URL", value, example, format: "url" };
}

const postgresKitCredentials = [["url", "DATABASE_DIRECT_URL"]] as const;
const postgresSchemaTemplates = { users: "users", auth: "auth" } as const;
const mysqlSchemaTemplates = {
	users: "users.mysql",
	auth: "auth.mysql",
} as const;
const sqliteSchemaTemplates = {
	users: "users.sqlite",
	auth: "auth.sqlite",
} as const;

const neonHttp = {
	clientTemplate: "neon-http",
	driver: "neon-http",
	databaseType: "NeonHttpDatabase",
	kitDialect: "postgresql",
	kitCredentials: postgresKitCredentials,
	schemaTemplates: postgresSchemaTemplates,
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
	kitCredentials: postgresKitCredentials,
	schemaTemplates: postgresSchemaTemplates,
	runtimeDeps: ["neonServerless"],
	devDeps: ["pg", "typesPg"],
} as const satisfies DrizzleSupport;

const nodePostgres = {
	clientTemplate: "node-postgres",
	driver: "node-postgres",
	databaseType: "NodePgDatabase",
	kitDialect: "postgresql",
	kitCredentials: postgresKitCredentials,
	schemaTemplates: postgresSchemaTemplates,
	runtimeDeps: ["pg"],
	devDeps: ["typesPg"],
} as const satisfies DrizzleSupport;

const postgresJs = {
	clientTemplate: "postgres-js",
	driver: "postgres-js",
	databaseType: "PostgresJsDatabase",
	kitDialect: "postgresql",
	kitCredentials: postgresKitCredentials,
	schemaTemplates: postgresSchemaTemplates,
	runtimeDeps: ["postgres"],
	devDeps: [],
} as const satisfies DrizzleSupport;

const planetscaleServerless = {
	clientTemplate: "planetscale-serverless",
	driver: "planetscale-serverless",
	databaseType: "PlanetScaleDatabase",
	kitDialect: "mysql",
	kitCredentials: [["url", "DATABASE_URL"]],
	schemaTemplates: { users: "users.mysql", auth: "auth.planetscale" },
	runtimeDeps: ["planetscaleDatabase"],
	// drizzle-kit speaks plain mysql to PlanetScale through mysql2.
	devDeps: ["mysql2"],
} as const satisfies DrizzleSupport;

const mysql2 = {
	clientTemplate: "mysql2",
	driver: "mysql2",
	databaseType: "MySql2Database",
	kitDialect: "mysql",
	kitCredentials: [["url", "DATABASE_URL"]],
	schemaTemplates: mysqlSchemaTemplates,
	runtimeDeps: ["mysql2"],
	devDeps: [],
} as const satisfies DrizzleSupport;

const libsqlTurso = {
	clientTemplate: "turso",
	driver: "libsql",
	databaseType: "LibSQLDatabase",
	kitDialect: "turso",
	kitCredentials: [
		["url", "TURSO_DATABASE_URL"],
		["authToken", "TURSO_AUTH_TOKEN"],
	],
	schemaTemplates: sqliteSchemaTemplates,
	runtimeDeps: ["libsqlClient"],
	devDeps: [],
} as const satisfies DrizzleSupport;

const libsqlFile = {
	clientTemplate: "libsql",
	driver: "libsql",
	databaseType: "LibSQLDatabase",
	kitDialect: "sqlite",
	kitCredentials: [["url", "DATABASE_URL"]],
	schemaTemplates: sqliteSchemaTemplates,
	runtimeDeps: ["libsqlClient"],
	devDeps: [],
} as const satisfies DrizzleSupport;

const prismaNeon = {
	clientTemplate: "neon",
	configTemplate: "direct-url",
	datasourceProvider: "postgresql",
	runtimeDeps: ["prismaAdapterNeon"],
	devDeps: [],
} as const satisfies PrismaSupport;

const prismaPg = {
	clientTemplate: "pg",
	configTemplate: "direct-url",
	datasourceProvider: "postgresql",
	runtimeDeps: ["prismaAdapterPg"],
	devDeps: [],
} as const satisfies PrismaSupport;

const prismaPlanetscale = {
	clientTemplate: "planetscale",
	configTemplate: "database-url",
	datasourceProvider: "mysql",
	relationMode: "prisma",
	// The Prisma CLI wants sslaccept=strict where mysql2 wants the ssl JSON.
	envVars: [
		databaseUrlEnvVar(
			"mysql://user:password@aws.connect.psdb.cloud/database?sslaccept=strict",
		),
	],
	runtimeDeps: ["prismaAdapterPlanetscale"],
	devDeps: [],
} as const satisfies PrismaSupport;

const prismaMariadb = {
	clientTemplate: "mariadb",
	configTemplate: "database-url",
	datasourceProvider: "mysql",
	runtimeDeps: ["prismaAdapterMariadb"],
	devDeps: [],
} as const satisfies PrismaSupport;

const prismaLibsql = {
	clientTemplate: "libsql",
	configTemplate: "turso",
	datasourceProvider: "sqlite",
	runtimeDeps: ["prismaAdapterLibsql"],
	devDeps: [],
} as const satisfies PrismaSupport;

const prismaBetterSqlite3 = {
	clientTemplate: "better-sqlite3",
	configTemplate: "local-file",
	datasourceProvider: "sqlite",
	runtimeDeps: ["prismaAdapterBetterSqlite3"],
	devDeps: ["typesBetterSqlite3"],
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

export const localMysql: DatabaseProviderProfile = {
	dialect: "mysql",
	envVars: [
		databaseUrlEnvVar(
			"mysql://root:password@localhost:3306/app",
			"mysql://user:password@host:3306/database",
		),
	],
	drizzle: mysql2,
	prisma: prismaMariadb,
};

export const localSqlite: DatabaseProviderProfile = {
	dialect: "sqlite",
	// Both apps/web and packages/db sit two levels deep, so the relative
	// file resolves to the workspace root from either working directory.
	envVars: [
		{
			name: "DATABASE_URL",
			value: "file:../../local.db",
			example: "file:../../local.db",
			format: "string",
		},
	],
	drizzle: libsqlFile,
	prisma: prismaBetterSqlite3,
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

const planetscaleMysql: DatabaseProviderProfile = {
	dialect: "mysql",
	envVars: [
		databaseUrlEnvVar(
			'mysql://user:password@aws.connect.psdb.cloud/database?ssl={"rejectUnauthorized":true}',
		),
	],
	drizzle: planetscaleServerless,
	prisma: prismaPlanetscale,
};

const turso: DatabaseProviderProfile = {
	dialect: "sqlite",
	envVars: [
		{
			name: "TURSO_DATABASE_URL",
			value: "libsql://database-name-org.aws-us-east-1.turso.io",
			example: "libsql://database-name-org.aws-us-east-1.turso.io",
			format: "url",
		},
		{
			name: "TURSO_AUTH_TOKEN",
			value: "change-me",
			example: "",
			format: "string",
		},
	],
	drizzle: libsqlTurso,
	prisma: prismaLibsql,
};

const localProfiles: Record<Database, DatabaseProviderProfile> = {
	mysql: localMysql,
	postgresql: localPostgres,
	sqlite: localSqlite,
};

const profilesByDialect: Record<
	Database,
	Partial<Record<DatabaseProvider, DatabaseProviderProfile>>
> = {
	mysql: { planetscale: planetscaleMysql },
	postgresql: postgresProfiles,
	sqlite: { turso },
};

export function resolveDatabaseProvider(
	config: ForgeConfig,
): DatabaseProviderProfile {
	const database = config.database ?? "postgresql";

	const provider = config.databaseProvider;
	if (provider === undefined) return localProfiles[database];

	return profilesByDialect[database][provider] ?? localProfiles[database];
}
