import {
	defineAddon,
	ensuredModuleTarget,
	ensurePackageModule,
	leafTextFile,
	surfaceDependencies,
	surfaceJson,
} from "@ryuujs/core";
import { type ForgeConfig, hasAddon } from "../config";
import { deps } from "../deps";
import type { FirstPartyAddonMetadata } from "../registry/types";
import { readTemplate } from "../template";

const shared = defineAddon<ForgeConfig, "shared">({
	id: "shared",
	name: "Shared Package",
	version: "0.1.0",
	category: "workspace",
	exclusive: true,
	dependencies: [{ id: "typescript", type: "addon" }],
	targetMode: "single",
	when: (config) => hasAddon(config, "shared"),
	contribute: ({ config }) => {
		const slug = config.slug ?? "my-app";

		const sharedPackageJson = {
			name: `@${slug}/shared`,
			private: true,
			type: "module",
			exports: {
				".": "./src/index.ts",
				"./*": "./src/*.ts",
			},
			scripts: {
				typecheck: "tsc --noEmit",
			},
		};

		const sharedTsconfig = {
			extends: `@${slug}/tsconfig/base.json`,
			include: ["."],
			exclude: ["node_modules", "dist"],
		};

		return [
			ensurePackageModule("shared", "packages/shared", {
				packageType: "library",
				template: { id: "shared", version: 1 },
				capabilities: ["shared"],
				slots: {},
			}),
			surfaceJson(
				ensuredModuleTarget("shared"),
				"packageJson",
				sharedPackageJson,
			),
			surfaceJson(ensuredModuleTarget("shared"), "tsconfig", sharedTsconfig),
			surfaceDependencies(ensuredModuleTarget("shared"), "packageJson", [
				{ ...deps.nanoid, type: "dependencies" },
				{
					name: `@${slug}/tsconfig`,
					version: "workspace:*",
					type: "devDependencies",
				},
				{ ...deps.typesNode, type: "devDependencies" },
				{ ...deps.typescript, type: "devDependencies" },
			]),
			leafTextFile(
				ensuredModuleTarget("shared"),
				"src/index.ts",
				readTemplate("shared/packages/shared/src/index.ts"),
			),
			leafTextFile(
				ensuredModuleTarget("shared"),
				"src/id.ts",
				readTemplate("shared/packages/shared/src/id.ts"),
			),
			leafTextFile(
				ensuredModuleTarget("shared"),
				"src/types.ts",
				readTemplate("shared/packages/shared/src/types.ts"),
			),
		];
	},
});

export const sharedMetadata = {
	description:
		"Creates a shared workspace package for utilities used across apps and packages.",
	experimental: false,
	hidden: false,
	id: "shared",
	keywords: ["shared", "utilities", "workspace"],
	kind: "addon",
	name: "Shared Package",
	summary: "Create a shared utilities package.",
} as const satisfies FirstPartyAddonMetadata;

export default shared;
