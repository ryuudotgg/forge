import { catalogRef, type VersionKey } from "./versions";

function dep(key: VersionKey) {
	return catalogRef(key);
}

export const deps = {
	biome: dep("biome"),
	commitlintCli: dep("commitlintCli"),
	commitlintConfigConventional: dep("commitlintConfigConventional"),
	commitlintTypes: dep("commitlintTypes"),
	lefthook: dep("lefthook"),
	sherif: dep("sherif"),
	turbo: dep("turbo"),
	typescript: dep("typescript"),
	typescriptNativePreview: dep("typescriptNativePreview"),

	next: dep("next"),
	react: dep("react"),
	reactDom: dep("reactDom"),
	serverOnly: dep("serverOnly"),
	typesNode: dep("typesNode"),
	typesReact: dep("typesReact"),
	typesReactDom: dep("typesReactDom"),

	tailwindcss: dep("tailwindcss"),
	tailwindPostcss: dep("tailwindPostcss"),
	twAnimateCss: dep("twAnimateCss"),

	trpcServer: dep("trpcServer"),
	trpcClient: dep("trpcClient"),
	trpcReactQuery: dep("trpcReactQuery"),
	tanstackReactQuery: dep("tanstackReactQuery"),
	superjson: dep("superjson"),

	drizzleOrm: dep("drizzleOrm"),
	drizzleKit: dep("drizzleKit"),
	drizzleZod: dep("drizzleZod"),
	neonServerless: dep("neonServerless"),
	libsqlClient: dep("libsqlClient"),
	planetscaleDatabase: dep("planetscaleDatabase"),
	mysql2: dep("mysql2"),

	prisma: dep("prisma"),
	prismaClient: dep("prismaClient"),
	prismaAdapterNeon: dep("prismaAdapterNeon"),
	prismaAdapterPg: dep("prismaAdapterPg"),
	prismaAdapterLibsql: dep("prismaAdapterLibsql"),
	prismaAdapterMariadb: dep("prismaAdapterMariadb"),
	prismaAdapterPlanetscale: dep("prismaAdapterPlanetscale"),
	prismaAdapterBetterSqlite3: dep("prismaAdapterBetterSqlite3"),

	pg: dep("pg"),
	postgres: dep("postgres"),
	typesBetterSqlite3: dep("typesBetterSqlite3"),
	typesPg: dep("typesPg"),

	dotenvCli: dep("dotenvCli"),

	t3OssEnvCore: dep("t3OssEnvCore"),
	t3OssEnvNextjs: dep("t3OssEnvNextjs"),
	zod: dep("zod"),

	clsx: dep("clsx"),
	nanoid: dep("nanoid"),
	tailwindMerge: dep("tailwindMerge"),
	classVarianceAuthority: dep("classVarianceAuthority"),

	baseUiReact: dep("baseUiReact"),
	shadcn: dep("shadcn"),
	nextThemes: dep("nextThemes"),
	sonner: dep("sonner"),
	inputOtp: dep("inputOtp"),

	betterAuth: dep("betterAuth"),
} as const;
