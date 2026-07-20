import {
	defineAddon,
	ensuredModuleTarget,
	ensurePackageModule,
	leafTextFile,
	surfaceDependencies,
	surfaceJson,
} from "@ryuujs/core";
import type { ForgeConfig } from "../../config";
import { deps } from "../../deps";
import type { FirstPartyAddonMetadata } from "../../registry/types";
import { interpolate, readTemplate } from "../../template";

const trpc = defineAddon<ForgeConfig, "trpc", "nextjs">({
	id: "trpc",
	name: "tRPC",
	version: "0.1.0",
	category: "addon",
	exclusive: false,
	dependencies: [
		{ id: "nextjs/base", type: "template" },
		{ id: "typescript", type: "addon" },
	],
	targetMode: "single",
	when: (config) => config.rpc === "trpc",
	contribute: ({ config }) => {
		const slug = config.slug ?? "my-app";

		const usesDb = config.orm !== undefined;
		const usesAuth = config.authentication === "better-auth";
		const vars = {
			SLUG: slug,
			DB_IMPORT: usesDb ? `import { db } from "@${slug}/db/client";\n` : "",
			DB_CTX_TYPE: usesDb ? "\n  db: typeof db;" : "",
			DB_CTX_VALUE: usesDb ? " db," : "",
			AUTH_TYPE_IMPORT: usesAuth
				? `import type { Auth } from "@${slug}/auth";\n`
				: "",
			AUTH_IMPORT: usesAuth ? `import { auth } from "@${slug}/auth";\n` : "",
			SESSION_TYPE: usesAuth
				? 'Awaited<ReturnType<Auth["api"]["getSession"]>>'
				: "{ user: { id: string; email: string } } | null",
			CTX_AUTH_PARAM: usesAuth ? "auth: Auth;\n  " : "",
			SESSION_RESOLVE: usesAuth
				? "const session = await opts.auth.api.getSession({ headers: opts.headers });"
				: "const session = null;",
			AUTH_ARG: usesAuth ? "auth, " : "",
		};

		const render = (path: string) =>
			interpolate(readTemplate(`api/trpc/${path}`), vars);

		const moduleDeps: Array<{
			name: string;
			version: string;
			type: "dependencies";
		}> = [];
		if (usesDb)
			moduleDeps.push({
				name: `@${slug}/db`,
				version: "workspace:*",
				type: "dependencies",
			});
		if (usesAuth)
			moduleDeps.push({
				name: `@${slug}/auth`,
				version: "workspace:*",
				type: "dependencies",
			});

		return [
			ensurePackageModule("trpc", "packages/trpc", {
				packageType: "library",
				template: { id: "trpc", version: 1 },
				capabilities: ["trpc"],
				slots: {},
			}),
			surfaceJson(ensuredModuleTarget("trpc"), "packageJson", {
				name: `@${slug}/trpc`,
				private: true,
				type: "module",
				exports: { ".": "./src/index.ts" },
				scripts: { typecheck: "tsc --noEmit" },
			}),
			surfaceJson(ensuredModuleTarget("trpc"), "tsconfig", {
				extends: `@${slug}/tsconfig/base.json`,
				compilerOptions: {
					types: ["node"],
					paths: { [`@${slug}/trpc/*`]: ["./src/*"] },
				},
				include: ["./src"],
				exclude: ["node_modules"],
			}),
			surfaceDependencies(ensuredModuleTarget("trpc"), "packageJson", [
				...moduleDeps,
				{ ...deps.trpcServer, type: "dependencies" },
				{ ...deps.superjson, type: "dependencies" },
				{ ...deps.zod, type: "dependencies" },
				{
					name: `@${slug}/tsconfig`,
					version: "workspace:*",
					type: "devDependencies",
				},
				{ ...deps.typesNode, type: "devDependencies" },
				{ ...deps.typescript, type: "devDependencies" },
			]),

			leafTextFile(
				ensuredModuleTarget("trpc"),
				"src/index.ts",
				render("packages/trpc/src/index.ts"),
			),
			leafTextFile(
				ensuredModuleTarget("trpc"),
				"src/trpc.ts",
				render("packages/trpc/src/trpc.ts"),
			),
			leafTextFile(
				ensuredModuleTarget("trpc"),
				"src/root.ts",
				render("packages/trpc/src/root.ts"),
			),

			leafTextFile(
				ensuredModuleTarget("web"),
				"trpc/query-client.ts",
				render("apps/web/trpc/query-client.ts"),
			),
			leafTextFile(
				ensuredModuleTarget("web"),
				"trpc/server.ts",
				render("apps/web/trpc/server.ts"),
			),
			leafTextFile(
				ensuredModuleTarget("web"),
				"trpc/react.tsx",
				render("apps/web/trpc/react.tsx"),
			),
			leafTextFile(
				ensuredModuleTarget("web"),
				"app/api/trpc/[trpc]/route.ts",
				render("apps/web/app/api/trpc/[trpc]/route.ts"),
			),
			surfaceDependencies(ensuredModuleTarget("web"), "packageJson", [
				{
					name: `@${slug}/trpc`,
					version: "workspace:*",
					type: "dependencies",
				},
				{ ...deps.trpcClient, type: "dependencies" },
				{ ...deps.trpcReactQuery, type: "dependencies" },
				{ ...deps.trpcServer, type: "dependencies" },
				{ ...deps.tanstackReactQuery, type: "dependencies" },
				{ ...deps.superjson, type: "dependencies" },
			]),
		];
	},
});

export const trpcMetadata = {
	description:
		"Adds tRPC server and client surfaces to compatible Forge application targets.",
	experimental: false,
	hidden: false,
	id: "trpc",
	keywords: ["api", "rpc", "trpc", "typescript"],
	kind: "addon",
	name: "tRPC",
	summary: "Add tRPC to an app target.",
} as const satisfies FirstPartyAddonMetadata;

export default trpc;
