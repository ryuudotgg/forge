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
	pg: dep("pg"),
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
