import type { PartialConfig } from "./steps/types";

interface CLIOption {
	type: "string" | "boolean";
	description: string;

	short?: string;
	configKey?: string;
	isValueList?: boolean;
}

export type OptionKey = keyof typeof options;

interface CLISection {
	title: string;
	keys: OptionKey[];
}

export const options = {
	help: { type: "boolean", short: "h", description: "You're looking at it!" },
	version: {
		type: "boolean",
		short: "v",
		description: "Returns the current version of Forge.",
	},

	config: {
		type: "string",
		short: "c",
		description: "Use a JSON Config File.",
	},

	preset: {
		type: "string",
		short: "p",
		description: "saas, api-only, fullstack",
		isValueList: true,
	},

	name: {
		type: "string",
		description: "A name for the project.",
		configKey: "name",
	},

	path: {
		type: "string",
		description: "Where you want the project to be created.",
		configKey: "path",
	},

	runtime: {
		type: "string",
		description: "Node.js, Bun, Deno",
		configKey: "runtime",
	},

	"package-manager": {
		type: "string",
		description: "pnpm, npm, Yarn, Bun",
		configKey: "packageManager",
	},

	catalogs: {
		type: "string",
		description: "Flat, Scoped (pnpm only)",
		configKey: "catalogs",
	},

	linter: {
		type: "string",
		description: "Biome, Oxc, ESLint + Prettier",
		configKey: "linter",
	},

	web: {
		type: "string",
		description: "Next.js, React Router, TanStack Router, TanStack Start",
		configKey: "web",
	},

	desktop: {
		type: "string",
		description: "Electron, Tauri",
		configKey: "desktop",
	},

	mobile: {
		type: "string",
		description: "Expo, React Native",
		configKey: "mobile",
	},

	backend: {
		type: "string",
		description: "Next.js, Convex, Hono, Elysia, etc.",
		configKey: "backend",
	},

	rpc: {
		type: "string",
		description: "tRPC, oRPC",
		configKey: "rpc",
	},

	database: {
		type: "string",
		description: "MySQL, PostgreSQL, SQLite",
		configKey: "database",
	},

	orm: {
		type: "string",
		description: "Drizzle ORM, Prisma",
		configKey: "orm",
	},

	auth: {
		type: "string",
		description: "Better Auth, Auth.js, WorkOS, Clerk",
		configKey: "authentication",
	},

	"database-provider": {
		type: "string",
		description: "PlanetScale, Neon, Turso, etc.",
		configKey: "databaseProvider",
	},

	style: {
		type: "string",
		description: "Tailwind CSS, UnoCSS",
		configKey: "style",
	},

	"native-style": {
		type: "string",
		description: "NativeWind, Tamagui, Unistyles",
		configKey: "nativeStyleFramework",
	},

	"accept-incoming": {
		type: "boolean",
		description: "Accept all incoming changes on conflicts.",
	},
} as const satisfies Record<string, CLIOption>;

export const sections: CLISection[] = [
	{
		title: "Options",
		keys: ["config", "preset", "accept-incoming", "help", "version"],
	},
	{
		title: "Field Overrides",
		keys: [
			"name",
			"path",
			"runtime",
			"package-manager",
			"catalogs",
			"linter",
			"web",
			"desktop",
			"mobile",
			"backend",
			"rpc",
			"database",
			"orm",
			"auth",
			"database-provider",
			"style",
			"native-style",
		],
	},
];

export function getParseArgsOptions(): Record<
	string,
	{ type: "string" | "boolean"; short?: string }
> {
	const result: Record<string, { type: "string" | "boolean"; short?: string }> =
		{};

	for (const [key, def] of Object.entries<CLIOption>(options)) {
		const entry: { type: "string" | "boolean"; short?: string } = {
			type: def.type,
		};

		if (def.short) entry.short = def.short;
		result[key] = entry;
	}

	return result;
}

export function buildFlagOverrides(
	values: Record<string, string | boolean | undefined>,
): PartialConfig {
	const overrides: PartialConfig = {};

	for (const [key, opt] of Object.entries<CLIOption>(options)) {
		const configKey = opt.configKey;
		if (!configKey) continue;

		const value = values[key];
		if (value !== undefined) overrides[configKey] = value;
	}

	return overrides;
}
