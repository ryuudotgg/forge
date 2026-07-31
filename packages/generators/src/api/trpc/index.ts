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
import { renderTrpcTemplate } from "./shared";

const trpc = defineAddon<ForgeConfig, "trpc">({
	id: "trpc",
	name: "tRPC",
	version: "0.1.0",
	category: "addon",
	exclusive: false,
	dependencies: [
		{ id: "nextjs/base", type: "template" },
		{ id: "tanstack-start/base", type: "template" },
		{ id: "typescript", type: "addon" },
	],
	targetMode: "single",
	when: (config) => config.rpc === "trpc",
	contribute: ({ config }) => {
		const slug = config.slug ?? "my-app";
		const usesDb = config.orm !== undefined;
		const usesAuth = config.authentication === "better-auth";

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
				renderTrpcTemplate(config, "packages/trpc/src/index.ts"),
			),
			leafTextFile(
				ensuredModuleTarget("trpc"),
				"src/trpc.ts",
				renderTrpcTemplate(config, "packages/trpc/src/trpc.ts"),
			),
			leafTextFile(
				ensuredModuleTarget("trpc"),
				"src/root.ts",
				renderTrpcTemplate(config, "packages/trpc/src/root.ts"),
			),
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
