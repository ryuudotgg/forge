import type { PartialConfig } from "./steps/types";

interface CLIOption {
	type: "string" | "boolean";
	description: string;

	short?: string;
	configKey?: string;
}

export type OptionKey = keyof typeof options;

interface CLISection {
	title: string;
	keys: OptionKey[];
}

export const options = {
	help: { type: "boolean", short: "h", description: "Show this help message" },
	version: { type: "boolean", short: "v", description: "Show version" },

	config: {
		type: "string",
		short: "c",
		description: "Load config from JSON (non-interactive)",
	},

	preset: {
		type: "string",
		short: "p",
		description: "Use a preset (saas, api-only, fullstack)",
	},

	name: {
		type: "string",
		description: "Project name",
		configKey: "name",
	},

	path: {
		type: "string",
		description: "Project path",
		configKey: "path",
	},

	runtime: {
		type: "string",
		description: "Node.js, Bun, Deno",
		configKey: "runtime",
	},

	"package-manager": {
		type: "string",
		description: "pnpm, npm, yarn, bun",
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
		description: "Tauri, Electron",
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

	"managed-provider": {
		type: "string",
		description: "PlanetScale, Neon, Turso, etc.",
		configKey: "managedProvider",
	},

	style: {
		type: "string",
		description: "Tailwind CSS, UnoCSS",
		configKey: "styleFramework",
	},

	"native-style": {
		type: "string",
		description: "NativeWind, Tamagui, Unistyles",
		configKey: "nativeStyleFramework",
	},
} as const satisfies Record<string, CLIOption>;

export const sections: CLISection[] = [
	{
		title: "Options",
		keys: ["config", "preset", "help", "version"],
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
			"managed-provider",
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
