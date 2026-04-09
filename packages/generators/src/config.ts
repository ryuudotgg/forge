import type { PackageManager, Runtime } from "@ryuujs/core";

function defineChoices<const T extends Record<string, string>>(definitions: T) {
	type ChoiceId = keyof T & string;

	const ids = Object.keys(definitions) as ReadonlyArray<ChoiceId>;
	const read = (id: ChoiceId) => {
		const value = definitions[id];
		if (value === undefined) throw new Error(`Missing Choice: ${id}`);
		return value;
	};
	const byDisplayName = new Map(ids.map((id) => [read(id).toLowerCase(), id]));

	function normalize(value: unknown): ChoiceId | undefined {
		if (typeof value !== "string") return undefined;
		if (ids.includes(value as ChoiceId)) return value as ChoiceId;

		return byDisplayName.get(value.toLowerCase());
	}

	function label(id: ChoiceId): T[ChoiceId] {
		return read(id);
	}

	return { definitions, ids, label, normalize };
}

export const platforms = defineChoices({
	web: "Web",
	desktop: "Desktop",
	mobile: "Mobile",
} as const);

export type Platform = keyof typeof platforms.definitions;

export const webFrameworks = defineChoices({
	nextjs: "Next.js",
	"react-router": "React Router",
	"tanstack-router": "TanStack Router",
	"tanstack-start": "TanStack Start",
} as const);

export type WebFramework = keyof typeof webFrameworks.definitions;

export const backends = defineChoices({
	nextjs: "Next.js",
	convex: "Convex",
	hono: "Hono",
	elysia: "Elysia",
	uwebsockets: "µWebSockets",
	fastify: "Fastify",
	express: "Express",
} as const);

export type Backend = keyof typeof backends.definitions;

export const rpcProviders = defineChoices({
	trpc: "tRPC",
	orpc: "oRPC",
} as const);

export type RpcProvider = keyof typeof rpcProviders.definitions;

export const databases = defineChoices({
	mysql: "MySQL",
	postgresql: "PostgreSQL",
	sqlite: "SQLite",
} as const);

export type Database = keyof typeof databases.definitions;

export const orms = defineChoices({
	drizzle: "Drizzle ORM",
	prisma: "Prisma",
} as const);

export type Orm = keyof typeof orms.definitions;

export const authenticationProviders = defineChoices({
	"better-auth": "Better Auth",
	authjs: "Auth.js",
	workos: "WorkOS",
	clerk: "Clerk",
} as const);

export type AuthenticationProvider =
	keyof typeof authenticationProviders.definitions;

export const styleFrameworks = defineChoices({
	tailwind: "Tailwind CSS",
	unocss: "UnoCSS",
} as const);

export type StyleFramework = keyof typeof styleFrameworks.definitions;

export const linters = defineChoices({
	biome: "Biome",
	oxc: "Oxc",
	"eslint-prettier": "ESLint + Prettier",
} as const);

export type Linter = keyof typeof linters.definitions;

export const catalogs = defineChoices({
	flat: "Flat",
	scoped: "Scoped",
} as const);

export type Catalogs = keyof typeof catalogs.definitions;

export const databaseProviders = defineChoices({
	planetscale: "PlanetScale",
	neon: "Neon",
	nile: "Nile",
	supabase: "Supabase",
	"prisma-postgres": "Prisma Postgres",
	turso: "Turso",
} as const);

export type DatabaseProvider = keyof typeof databaseProviders.definitions;

export const desktopFrameworks = defineChoices({
	electron: "Electron",
	tauri: "Tauri",
} as const);

export type DesktopFramework = keyof typeof desktopFrameworks.definitions;

export const mobileFrameworks = defineChoices({
	expo: "Expo",
	"react-native": "React Native",
} as const);

export type MobileFramework = keyof typeof mobileFrameworks.definitions;

export const nativeStyleFrameworks = defineChoices({
	nativewind: "NativeWind",
	tamagui: "Tamagui",
	unistyles: "Unistyles",
} as const);

export type NativeStyleFramework =
	keyof typeof nativeStyleFrameworks.definitions;

export interface ForgeConfig {
	readonly [key: string]: unknown;
	readonly name?: string;
	readonly slug?: string;
	readonly path?: string;
	readonly runtime?: Runtime;
	readonly packageManager?: PackageManager;
	readonly catalogs?: Catalogs;
	readonly linter?: Linter;
	readonly platforms?: ReadonlyArray<Platform>;
	readonly web?: WebFramework;
	readonly backend?: Backend;
	readonly rpc?: RpcProvider;
	readonly orm?: Orm;
	readonly authentication?: AuthenticationProvider;
	readonly database?: Database;
	readonly databaseProvider?: DatabaseProvider;
	readonly style?: StyleFramework;
	readonly desktop?: DesktopFramework;
	readonly mobile?: MobileFramework;
	readonly nativeStyleFramework?: NativeStyleFramework;
}
