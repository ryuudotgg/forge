export const deps = {
	biome: { name: "@biomejs/biome", version: "2.4.10" },
	turbo: { name: "turbo", version: "^2.9.3" },
	typescript: { name: "typescript", version: "6.0.2" },

	next: { name: "next", version: "^16.1.7" },
	react: { name: "react", version: "^19.2.4" },
	reactDom: { name: "react-dom", version: "^19.2.4" },
	typesReact: { name: "@types/react", version: "^19.2.14" },
	typesReactDom: { name: "@types/react-dom", version: "^19.2.3" },

	tailwindcss: { name: "tailwindcss", version: "^4.1.7" },
	tailwindPostcss: { name: "@tailwindcss/postcss", version: "^4.1.7" },
	postcss: { name: "postcss", version: "^8.5.6" },

	trpcServer: { name: "@trpc/server", version: "^11.5.1" },
	trpcClient: { name: "@trpc/client", version: "^11.5.1" },
	trpcReactQuery: {
		name: "@trpc/tanstack-react-query",
		version: "^11.5.1",
	},
	tanstackReactQuery: {
		name: "@tanstack/react-query",
		version: "^5.87.1",
	},
	superjson: { name: "superjson", version: "^2.2.2" },

	drizzleOrm: { name: "drizzle-orm", version: "^1.0.0-beta.1" },
	drizzleKit: { name: "drizzle-kit", version: "^1.0.0-beta.1" },
	neonServerless: {
		name: "@neondatabase/serverless",
		version: "^1.0.0",
	},

	clsx: { name: "clsx", version: "^2.1.1" },
	tailwindMerge: { name: "tailwind-merge", version: "^3.3.1" },

	betterAuth: { name: "better-auth", version: "^1.3.8" },
} as const;
