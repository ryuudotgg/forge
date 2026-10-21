import {
	defineAddon,
	ensuredModuleTarget,
	ensurePackageModule,
	leafTextFile,
	surfaceDependencies,
	surfaceJson,
} from "@ryuugg/core";
import { Effect } from "effect";
import { apiHostFramework, rpcProviderError } from "../../api-host";
import type { ForgeConfig } from "../../config";
import { deps } from "../../deps";
import type { FirstPartyAddonMetadata } from "../../registry/types";
import { renderOrpcTemplate } from "./shared";

const orpc = defineAddon<ForgeConfig, "orpc">({
	id: "orpc",
	name: "oRPC",
	version: "0.1.0",
	category: "addon",
	exclusive: false,
	dependencies: [{ id: "typescript", type: "addon" }],
	targetMode: "single",
	target: (config, module) =>
		module.type === "app" &&
		module.framework === apiHostFramework(config) &&
		module.slots.orpc !== undefined,
	when: (config) => config.rpc === "orpc",
	contribute: ({ config, frameworks }) => {
		const failure = rpcProviderError(config, "orpc", frameworks);
		if (failure !== undefined) return Effect.fail(failure);

		const slug = config.slug ?? "my-app";
		const moduleDeps: Array<{
			name: string;
			version: string;
			type: "dependencies";
		}> = [];

		if (config.orm !== undefined)
			moduleDeps.push({
				name: `@${slug}/db`,
				version: "workspace:*",
				type: "dependencies",
			});

		if (config.authentication === "better-auth")
			moduleDeps.push({
				name: `@${slug}/auth`,
				version: "workspace:*",
				type: "dependencies",
			});

		const target = ensuredModuleTarget("orpc");
		return [
			ensurePackageModule("orpc", "packages/orpc", {
				packageType: "library",
				template: { id: "orpc", version: 1 },
				capabilities: ["orpc"],
				slots: {},
			}),
			surfaceJson(target, "packageJson", {
				name: `@${slug}/orpc`,
				private: true,
				type: "module",
				exports: { ".": "./src/index.ts" },
				scripts: { typecheck: "tsc --noEmit" },
			}),
			surfaceJson(target, "tsconfig", {
				extends: `@${slug}/tsconfig/base.json`,
				compilerOptions: {
					types: ["node"],
					paths: { [`@${slug}/orpc/*`]: ["./src/*"] },
				},
				include: ["./src"],
				exclude: ["node_modules"],
			}),
			surfaceDependencies(target, "packageJson", [
				...moduleDeps,
				{ ...deps.orpcServer, type: "dependencies" },
				{
					name: `@${slug}/tsconfig`,
					version: "workspace:*",
					type: "devDependencies",
				},
				{ ...deps.typesNode, type: "devDependencies" },
				{ ...deps.typescript, type: "devDependencies" },
			]),
			...["index", "orpc", "router"].map((name) =>
				leafTextFile(
					target,
					`src/${name}.ts`,
					renderOrpcTemplate(config, `packages/orpc/src/${name}.ts`),
				),
			),
		];
	},
});

export const orpcMetadata = {
	description:
		"Adds oRPC server and client files to compatible Forge application targets.",
	experimental: false,
	hidden: false,
	id: "orpc",
	keywords: ["api", "rpc", "orpc", "typescript"],
	kind: "addon",
	name: "oRPC",
	summary: "Add oRPC to an app target.",
} as const satisfies FirstPartyAddonMetadata;

export default orpc;
