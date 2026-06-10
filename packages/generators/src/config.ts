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

export const uiLibraries = defineChoices({
	"base-ui": "Base UI",
	radix: "Radix UI",
} as const);

export type UiLibrary = keyof typeof uiLibraries.definitions;

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

export const optionalAddons = defineChoices({
	commitlint: "commitlint",
	"github-ci": "GitHub CI",
	lefthook: "Lefthook",
	shared: "Shared Package",
	vscode: "VS Code",
} as const);

export type OptionalAddon = keyof typeof optionalAddons.definitions;

export const recommendedAddons: ReadonlyArray<OptionalAddon> = [
	"commitlint",
	"github-ci",
	"lefthook",
	"vscode",
];

export function hasAddon(config: ForgeConfig, addon: OptionalAddon): boolean {
	return config.addons?.includes(addon) ?? false;
}

export function withAddon(config: ForgeConfig, addon: string): ForgeConfig {
	const normalized = optionalAddons.normalize(addon);
	if (normalized === undefined || hasAddon(config, normalized)) return config;

	return { ...config, addons: [...(config.addons ?? []), normalized] };
}

export function withoutAddon(config: ForgeConfig, addon: string): ForgeConfig {
	const normalized = optionalAddons.normalize(addon);
	if (normalized === undefined || !hasAddon(config, normalized)) return config;

	return {
		...config,
		addons: (config.addons ?? []).filter((entry) => entry !== normalized),
	};
}

export const addonConfigBindings: Readonly<
	Record<string, Partial<ForgeConfig>>
> = {
	"better-auth": { authentication: "better-auth" },
	biome: { linter: "biome" },
	drizzle: { orm: "drizzle" },
	prisma: { orm: "prisma" },
	tailwind: { style: "tailwind" },
	trpc: { rpc: "trpc" },
};

export function configWithInstall(
	config: ForgeConfig,
	addonId: string,
): ForgeConfig {
	const binding = addonConfigBindings[addonId];
	if (binding === undefined) return withAddon(config, addonId);

	return { ...config, ...binding };
}

export function configWithoutInstall(
	config: ForgeConfig,
	addonId: string,
): ForgeConfig {
	const binding = addonConfigBindings[addonId];
	if (binding === undefined) return withoutAddon(config, addonId);

	const next = { ...config };
	for (const [field, value] of Object.entries(binding))
		if (next[field] === value) delete next[field];

	return next;
}

export function installConflict(
	addonId: string,
	installedIds: ReadonlyArray<string>,
): string | undefined {
	const binding = addonConfigBindings[addonId];
	if (binding === undefined) return undefined;

	const fields = Object.keys(binding);

	return Object.entries(addonConfigBindings).find(
		([id, other]) =>
			id !== addonId &&
			installedIds.includes(id) &&
			Object.keys(other).some((field) => fields.includes(field)),
	)?.[0];
}

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
	readonly uiLibrary?: UiLibrary;
	readonly desktop?: DesktopFramework;
	readonly mobile?: MobileFramework;
	readonly nativeStyleFramework?: NativeStyleFramework;
	readonly addons?: ReadonlyArray<OptionalAddon>;
}
