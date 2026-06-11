import {
	defineAddon,
	ensuredModuleTarget,
	ensurePackageModule,
	leafTextFile,
	projectTarget,
	surfaceDependencies,
	surfaceJson,
	surfaceLines,
	surfaceScripts,
} from "@ryuujs/core";
import type { ForgeConfig } from "../../config";
import {
	drizzleKitCredentials,
	envFileLine,
	envRuntimeLines,
	envServerLines,
	resolveDatabaseProvider,
} from "../../data/providers";
import { deps } from "../../deps";
import { pmRun, pmRunIn, resolvePackageManager } from "../../pm";
import type { FirstPartyAddonMetadata } from "../../registry/types";
import { interpolate, readTemplate } from "../../template";

const drizzle = defineAddon<ForgeConfig, "drizzle", "nextjs">({
	id: "drizzle",
	name: "Drizzle",
	version: "0.1.0",
	category: "orm",
	exclusive: true,
	dependencies: [{ id: "typescript", type: "addon" }],
	targetMode: "single",
	when: (config) => config.orm === "drizzle",
	contribute: ({ config }) => {
		const slug = config.slug ?? "my-app";

		const pm = resolvePackageManager(config);
		const dbPackage = { name: `@${slug}/db`, path: "../../packages/db" };
		const provider = resolveDatabaseProvider(config);

		const usesAuth = config.authentication === "better-auth";
		const vars = {
			SLUG: slug,
			AUTH_EXPORT: usesAuth ? 'export * from "./auth";\n' : "",
			DATABASE_TYPE: provider.drizzle.databaseType,
			DRIZZLE_DRIVER: provider.drizzle.driver,
			ENV_RUNTIME: envRuntimeLines(provider.envVars),
			ENV_SERVER: envServerLines(provider.envVars),
			KIT_CREDENTIALS: drizzleKitCredentials(provider.drizzle),
			KIT_DIALECT: provider.drizzle.kitDialect,
		};

		const render = (path: string) =>
			interpolate(readTemplate(`orm/drizzle/${path}`), vars);

		return [
			ensurePackageModule("db", "packages/db", {
				packageType: "library",
				template: { id: "db", version: 1 },
				capabilities: ["db", "drizzle"],
				slots: {},
			}),
			surfaceJson(ensuredModuleTarget("db"), "packageJson", {
				name: `@${slug}/db`,
				private: true,
				type: "module",
				exports: {
					".": "./src/index.ts",
					"./client": "./src/client.ts",
					"./relations": "./src/schema/relations.ts",
					"./schema": "./src/schema/index.ts",
					"./schema/*": "./src/schema/*.ts",
					"./env": "./env.ts",
				},
				scripts: {
					generate: pmRun(pm, "with-env", "drizzle-kit generate"),
					migrate: pmRun(pm, "with-env", "drizzle-kit migrate"),
					push: pmRun(pm, "with-env", "drizzle-kit push"),
					studio: pmRun(pm, "with-env", "drizzle-kit studio"),
					typecheck: "tsgo --noEmit",
					"with-env": "dotenv -e ../../.env --",
				},
			}),
			surfaceJson(ensuredModuleTarget("db"), "tsconfig", {
				extends: `@${slug}/tsconfig/base.json`,
				compilerOptions: {
					types: ["node"],
					paths: { [`@${slug}/db/*`]: ["./src/*"] },
				},
				include: ["./src", "./*.ts"],
				exclude: ["node_modules"],
			}),
			surfaceDependencies(ensuredModuleTarget("db"), "packageJson", [
				...provider.drizzle.runtimeDeps.map((key) => ({
					...deps[key],
					type: "dependencies" as const,
				})),
				{ ...deps.t3OssEnvCore, type: "dependencies" },
				{ ...deps.drizzleOrm, type: "dependencies" },
				{ ...deps.drizzleZod, type: "dependencies" },
				{ ...deps.zod, type: "dependencies" },
				{
					name: `@${slug}/tsconfig`,
					version: "workspace:*",
					type: "devDependencies",
				},
				...provider.drizzle.devDeps.map((key) => ({
					...deps[key],
					type: "devDependencies" as const,
				})),
				{ ...deps.typesNode, type: "devDependencies" },
				{ ...deps.typescriptNativePreview, type: "devDependencies" },
				{ ...deps.dotenvCli, type: "devDependencies" },
				{ ...deps.drizzleKit, type: "devDependencies" },
				{ ...deps.typescript, type: "devDependencies" },
			]),

			leafTextFile(
				ensuredModuleTarget("db"),
				"env.ts",
				render("packages/db/env.ts"),
			),
			leafTextFile(
				ensuredModuleTarget("db"),
				"drizzle.config.ts",
				render("packages/db/drizzle.config.ts"),
			),
			leafTextFile(
				ensuredModuleTarget("db"),
				"src/client.ts",
				render(`packages/db/src/client.${provider.drizzle.clientTemplate}.ts`),
			),
			leafTextFile(
				ensuredModuleTarget("db"),
				"src/index.ts",
				render("packages/db/src/index.ts"),
			),
			leafTextFile(
				ensuredModuleTarget("db"),
				"src/schema/index.ts",
				render("packages/db/src/schema/index.ts"),
			),
			leafTextFile(
				ensuredModuleTarget("db"),
				"src/schema/relations.ts",
				render(
					usesAuth
						? "packages/db/src/schema/relations.ts"
						: "packages/db/src/schema/relations.base.ts",
				),
			),
			leafTextFile(
				ensuredModuleTarget("db"),
				"src/schema/users/index.ts",
				render("packages/db/src/schema/users/index.ts"),
			),
			leafTextFile(
				ensuredModuleTarget("db"),
				"src/schema/users/users.ts",
				render(
					`packages/db/src/schema/users/${provider.drizzle.schemaTemplates.users}.ts`,
				),
			),
			...(usesAuth
				? [
						leafTextFile(
							ensuredModuleTarget("db"),
							"src/schema/auth.ts",
							render(
								`packages/db/src/schema/${provider.drizzle.schemaTemplates.auth}.ts`,
							),
						),
					]
				: []),

			surfaceDependencies(ensuredModuleTarget("web"), "packageJson", [
				{
					name: `@${slug}/db`,
					version: "workspace:*",
					type: "dependencies",
				},
			]),

			surfaceLines(
				projectTarget(),
				"rootEnv",
				provider.envVars.map(({ name, value }) => envFileLine(name, value)),
				{ section: "Database" },
			),
			surfaceLines(
				projectTarget(),
				"rootEnvExample",
				provider.envVars.map(({ name, example }) => envFileLine(name, example)),
				{ section: "Database" },
			),
			...(provider.drizzle.clientTemplate === "libsql"
				? [
						surfaceLines(projectTarget(), "gitignore", ["/local.db*"], {
							section: "Database",
						}),
					]
				: []),

			surfaceScripts(ensuredModuleTarget("web"), "packageJson", {
				"db:generate": pmRunIn(pm, dbPackage, "generate"),
				"db:migrate": pmRunIn(pm, dbPackage, "migrate"),
				"db:push": pmRunIn(pm, dbPackage, "push"),
				"db:studio": pmRunIn(pm, dbPackage, "studio"),
			}),
		];
	},
});

export const drizzleMetadata = {
	description:
		"Adds Drizzle ORM configuration, schema surfaces, and database tooling to a compatible app.",
	experimental: false,
	hidden: false,
	id: "drizzle",
	keywords: ["database", "drizzle", "orm", "sql"],
	kind: "addon",
	name: "Drizzle",
	summary: "Add Drizzle ORM support.",
} as const satisfies FirstPartyAddonMetadata;

export default drizzle;
