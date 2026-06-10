import {
	defineAddon,
	ensuredModuleTarget,
	ensurePackageModule,
	leafTextFile,
	projectTarget,
	surfaceDependencies,
	surfaceJson,
	surfaceLines,
} from "@ryuujs/core";
import type { ForgeConfig } from "../../config";
import { deps } from "../../deps";
import { pmDlx, resolvePackageManager } from "../../pm";
import type { FirstPartyAddonMetadata } from "../../registry/types";
import { interpolate, readTemplate } from "../../template";

const betterAuthAddon = defineAddon<ForgeConfig, "better-auth", "nextjs">({
	id: "better-auth",
	name: "Better Auth",
	version: "0.1.0",
	category: "auth",
	exclusive: true,
	dependencies: [
		{ id: "nextjs/base", type: "template" },
		{ id: "drizzle", type: "addon" },
	],
	targetMode: "single",
	when: (config) => config.authentication === "better-auth",
	contribute: ({ config }) => {
		const slug = config.slug ?? "my-app";

		const pm = resolvePackageManager(config);
		const secretCommand = pmDlx(pm, "@better-auth/cli secret");

		const vars = { SLUG: slug };
		const render = (path: string) =>
			interpolate(readTemplate(`auth/better-auth/${path}`), vars);

		return [
			ensurePackageModule("auth", "packages/auth", {
				packageType: "library",
				template: { id: "auth", version: 1 },
				capabilities: ["auth"],
				slots: {},
			}),
			surfaceJson(ensuredModuleTarget("auth"), "packageJson", {
				name: `@${slug}/auth`,
				private: true,
				type: "module",
				exports: {
					".": "./src/index.ts",
					"./env": "./env.ts",
					"./client": "./src/client.ts",
				},
				scripts: { typecheck: "tsgo --noEmit" },
			}),
			surfaceJson(ensuredModuleTarget("auth"), "tsconfig", {
				extends: `@${slug}/tsconfig/base.json`,
				compilerOptions: {
					types: ["node"],
					paths: { [`@${slug}/auth/*`]: ["./src/*"] },
				},
				include: ["./src", "./*.ts"],
				exclude: ["node_modules"],
			}),
			surfaceDependencies(ensuredModuleTarget("auth"), "packageJson", [
				{
					name: `@${slug}/db`,
					version: "workspace:*",
					type: "dependencies",
				},
				{ ...deps.t3OssEnvCore, type: "dependencies" },
				{ ...deps.betterAuth, type: "dependencies" },
				{ ...deps.zod, type: "dependencies" },
				{
					name: `@${slug}/tsconfig`,
					version: "workspace:*",
					type: "devDependencies",
				},
				{ ...deps.typesNode, type: "devDependencies" },
				{ ...deps.typescriptNativePreview, type: "devDependencies" },
				{ ...deps.typescript, type: "devDependencies" },
			]),

			leafTextFile(
				ensuredModuleTarget("auth"),
				"env.ts",
				render("packages/auth/env.ts"),
			),
			leafTextFile(
				ensuredModuleTarget("auth"),
				"src/index.ts",
				render("packages/auth/src/index.ts"),
			),
			leafTextFile(
				ensuredModuleTarget("auth"),
				"src/client.ts",
				render("packages/auth/src/client.ts"),
			),
			leafTextFile(
				ensuredModuleTarget("web"),
				"app/api/auth/[...all]/route.ts",
				render("apps/web/app/api/auth/[...all]/route.ts"),
			),
			surfaceDependencies(ensuredModuleTarget("web"), "packageJson", [
				{
					name: `@${slug}/auth`,
					version: "workspace:*",
					type: "dependencies",
				},
				{ ...deps.betterAuth, type: "dependencies" },
			]),

			surfaceLines(
				projectTarget(),
				"rootEnv",
				[
					`# @use ${secretCommand}`,
					'AUTH_SECRET="change-me-locally-or-generate-with-the-cli-above"',
					'AUTH_COOKIE_DOMAIN="" # empty for localhost, eg. ".example.com"',
					"",
					'APP_ORIGIN="http://localhost:3000"',
					"",
					'AUTH_GOOGLE_CLIENT_ID=""',
					'AUTH_GOOGLE_CLIENT_SECRET=""',
					"",
					'AUTH_APPLE_CLIENT_ID=""',
					'AUTH_APPLE_CLIENT_SECRET=""',
				],
				{ section: "Better Auth" },
			),
			surfaceLines(
				projectTarget(),
				"rootEnvExample",
				[
					`# @use ${secretCommand}`,
					'AUTH_SECRET=""',
					'AUTH_COOKIE_DOMAIN="" # empty for localhost, eg. ".example.com"',
					"",
					'APP_ORIGIN="http://localhost:3000"',
					"",
					'AUTH_GOOGLE_CLIENT_ID=""',
					'AUTH_GOOGLE_CLIENT_SECRET=""',
					"",
					'AUTH_APPLE_CLIENT_ID=""',
					'AUTH_APPLE_CLIENT_SECRET=""',
				],
				{ section: "Better Auth" },
			),
		];
	},
});

export const betterAuthMetadata = {
	description:
		"Adds Better Auth server and client surfaces to a compatible application target.",
	experimental: false,
	hidden: false,
	id: "better-auth",
	keywords: ["auth", "authentication", "better-auth"],
	kind: "addon",
	name: "Better Auth",
	summary: "Add Better Auth to an app target.",
} as const satisfies FirstPartyAddonMetadata;

export default betterAuthAddon;
