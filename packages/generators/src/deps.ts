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
	vitest: dep("vitest"),
	tsdown: dep("tsdown"),
	tsx: dep("tsx"),

	betterAuthExpo: dep("betterAuthExpo"),
	expo: dep("expo"),
	expoConstants: dep("expoConstants"),
	expoLinking: dep("expoLinking"),
	expoRouter: dep("expoRouter"),
	expoSecureStore: dep("expoSecureStore"),
	isbot: dep("isbot"),
	serverOnly: dep("serverOnly"),
	hono: dep("hono"),
	honoNodeServer: dep("honoNodeServer"),
	honoTrpcServer: dep("honoTrpcServer"),

	next: dep("next"),

	react: dep("react"),
	reactDom: dep("reactDom"),
	reactNative: dep("reactNative"),
	reactNativeSafeAreaContext: dep("reactNativeSafeAreaContext"),
	reactNativeScreens: dep("reactNativeScreens"),

	reactRouter: dep("reactRouter"),
	reactRouterDev: dep("reactRouterDev"),
	reactRouterNode: dep("reactRouterNode"),
	reactRouterServe: dep("reactRouterServe"),

	tanstackReactRouter: dep("tanstackReactRouter"),
	tanstackReactStart: dep("tanstackReactStart"),
	tanstackRouterCli: dep("tanstackRouterCli"),
	tanstackRouterPlugin: dep("tanstackRouterPlugin"),

	vite: dep("vite"),
	viteReact: dep("viteReact"),

	typesNode: dep("typesNode"),
	typesReact: dep("typesReact"),
	typesReactDom: dep("typesReactDom"),

	tailwindcss: dep("tailwindcss"),
	tailwindVite: dep("tailwindVite"),
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
