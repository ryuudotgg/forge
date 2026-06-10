import type { ForgeConfig } from "./config";

export type CatalogGroup =
	| "Framework"
	| "UI"
	| "Styling"
	| "Validation & Env"
	| "Database"
	| "Utilities"
	| "Tooling"
	| "Types";

export interface CatalogEntry {
	readonly name: string;
	readonly version: string;
	readonly group: CatalogGroup;
}

export const versions = {
	biome: { name: "@biomejs/biome", version: "^2.4.11", group: "Tooling" },
	commitlintCli: {
		name: "@commitlint/cli",
		version: "^20.1.0",
		group: "Tooling",
	},
	commitlintConfigConventional: {
		name: "@commitlint/config-conventional",
		version: "^20.0.0",
		group: "Tooling",
	},
	commitlintTypes: {
		name: "@commitlint/types",
		version: "^20.0.0",
		group: "Tooling",
	},
	lefthook: { name: "lefthook", version: "^2.0.0", group: "Tooling" },
	sherif: { name: "sherif", version: "^1.11.1", group: "Tooling" },
	turbo: { name: "turbo", version: "^2.9.6", group: "Tooling" },
	typescript: { name: "typescript", version: "^6.0.2", group: "Tooling" },
	typescriptNativePreview: {
		name: "@typescript/native-preview",
		version: "^7.0.0-dev.20260414.1",
		group: "Tooling",
	},

	next: { name: "next", version: "16.2.3", group: "Framework" },
	react: { name: "react", version: "^19.2.5", group: "Framework" },
	reactDom: { name: "react-dom", version: "^19.2.5", group: "Framework" },
	serverOnly: { name: "server-only", version: "^0.0.1", group: "Framework" },

	tailwindcss: { name: "tailwindcss", version: "^4.2.2", group: "Styling" },
	tailwindPostcss: {
		name: "@tailwindcss/postcss",
		version: "^4.2.2",
		group: "Styling",
	},
	twAnimateCss: {
		name: "tw-animate-css",
		version: "^1.4.0",
		group: "UI",
	},

	trpcServer: { name: "@trpc/server", version: "^11.7.1", group: "Framework" },
	trpcClient: { name: "@trpc/client", version: "^11.7.1", group: "Framework" },
	trpcReactQuery: {
		name: "@trpc/react-query",
		version: "^11.7.1",
		group: "Framework",
	},
	tanstackReactQuery: {
		name: "@tanstack/react-query",
		version: "^5.90.5",
		group: "UI",
	},
	superjson: { name: "superjson", version: "^2.2.5", group: "Utilities" },

	drizzleOrm: {
		name: "drizzle-orm",
		version: "1.0.0-beta.21",
		group: "Database",
	},
	drizzleKit: {
		name: "drizzle-kit",
		version: "1.0.0-beta.21",
		group: "Database",
	},
	drizzleZod: {
		name: "drizzle-zod",
		version: "^1.0.0-beta.12",
		group: "Database",
	},
	neonServerless: {
		name: "@neondatabase/serverless",
		version: "^1.0.2",
		group: "Database",
	},
	pg: {
		name: "pg",
		version: "^8.21.0",
		group: "Database",
	},
	postgres: {
		name: "postgres",
		version: "^3.4.9",
		group: "Database",
	},
	dotenvCli: {
		name: "dotenv-cli",
		version: "^10.0.0",
		group: "Utilities",
	},

	t3OssEnvCore: {
		name: "@t3-oss/env-core",
		version: "^0.13.11",
		group: "Validation & Env",
	},
	t3OssEnvNextjs: {
		name: "@t3-oss/env-nextjs",
		version: "^0.13.11",
		group: "Validation & Env",
	},
	zod: { name: "zod", version: "^4.3.6", group: "Validation & Env" },

	clsx: { name: "clsx", version: "^2.1.1", group: "Utilities" },
	nanoid: { name: "nanoid", version: "^5.1.11", group: "Utilities" },
	tailwindMerge: {
		name: "tailwind-merge",
		version: "^3.5.0",
		group: "Utilities",
	},
	classVarianceAuthority: {
		name: "class-variance-authority",
		version: "^0.7.1",
		group: "Utilities",
	},

	baseUiReact: { name: "@base-ui/react", version: "^1.5.0", group: "UI" },
	shadcn: { name: "shadcn", version: "^4.2.0", group: "UI" },
	nextThemes: { name: "next-themes", version: "^0.4.6", group: "Framework" },
	sonner: { name: "sonner", version: "^2.0.7", group: "UI" },
	inputOtp: { name: "input-otp", version: "^1.4.2", group: "UI" },

	betterAuth: {
		name: "better-auth",
		version: "^1.6.3",
		group: "Framework",
	},

	typesNode: { name: "@types/node", version: "^25.6.0", group: "Types" },
	typesPg: { name: "@types/pg", version: "^8.20.0", group: "Types" },
	typesReact: { name: "@types/react", version: "^19.2.14", group: "Types" },
	typesReactDom: {
		name: "@types/react-dom",
		version: "^19.2.3",
		group: "Types",
	},
} as const satisfies Record<string, CatalogEntry>;

export type VersionKey = keyof typeof versions;

export function catalogRef(key: VersionKey) {
	return {
		name: versions[key].name,
		version: versions[key].version,
		catalog: "",
	};
}

const groupOrder: ReadonlyArray<CatalogGroup> = [
	"Framework",
	"UI",
	"Styling",
	"Validation & Env",
	"Database",
	"Utilities",
	"Tooling",
	"Types",
];

export function catalogEntries(_config: ForgeConfig): ReadonlyArray<{
	readonly group: CatalogGroup;
	readonly entries: ReadonlyArray<CatalogEntry>;
}> {
	const grouped = new Map<CatalogGroup, CatalogEntry[]>();

	for (const key of Object.keys(versions) as VersionKey[]) {
		const entry = versions[key];
		const list = grouped.get(entry.group) ?? [];
		list.push(entry);
		grouped.set(entry.group, list);
	}

	return groupOrder
		.filter((group) => grouped.has(group))
		.map((group) => ({
			group,
			entries: (grouped.get(group) ?? [])
				.slice()
				.sort((a, b) => a.name.localeCompare(b.name)),
		}));
}
