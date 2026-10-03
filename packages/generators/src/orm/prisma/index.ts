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
} from "@ryuugg/core";
import { authUsesPassword } from "../../auth/methods";
import {
	type AuthField,
	authPluginFields,
	authPluginTables,
} from "../../auth/plugins";
import type { ForgeConfig } from "../../config";
import {
	envFileLine,
	envRuntimeLines,
	envServerLines,
	type PrismaDatasourceProvider,
	resolveDatabaseProvider,
} from "../../data/providers";
import { deps } from "../../deps";
import { pmRun, pmRunIn, resolvePackageManager } from "../../pm";
import type { FirstPartyAddonMetadata } from "../../registry/types";
import { interpolate, readTemplate } from "../../template";
import { catalogRef } from "../../versions";
import { prismaUserRelations, renderPrismaAuthTables } from "./auth-schema";

const authFieldTypes: Record<AuthField["type"], string> = {
	string: "String?",
	boolean: "Boolean?",
	date: "DateTime?",
};

function prismaAuthFields(
	fields: ReadonlyArray<AuthField>,
	datasource: PrismaDatasourceProvider,
): string {
	if (fields.length === 0) return "";

	const nameWidth = Math.max(...fields.map(({ name }) => name.length));
	const typeWidth = Math.max(
		...fields.map(({ type }) => authFieldTypes[type].length),
	);

	const columns = fields.map((field) => {
		const snakeName = field.name.replace(
			/[A-Z]/g,
			(letter) => `_${letter.toLowerCase()}`,
		);

		const attributes = [
			...(field.unique ? ["@unique"] : []),
			...(field.default === false ? ["@default(false)"] : []),
			...(snakeName !== field.name ? [`@map("${snakeName}")`] : []),
		];

		const fieldType = authFieldTypes[field.type];
		const hasNativeAttribute =
			(field.type === "string" && !field.unique && datasource === "mysql") ||
			(field.type === "date" && datasource === "postgresql");

		const definition =
			attributes.length > 0 || hasNativeAttribute
				? `${fieldType.padEnd(typeWidth)}${attributes.length > 0 ? ` ${attributes.join(" ")}` : ""}`
				: fieldType;

		const nativeType =
			field.type === "date"
				? "__TIMESTAMPTZ__"
				: field.type === "string" && !field.unique
					? "__TEXT__"
					: "";

		return `  ${field.name.padEnd(nameWidth)} ${definition}${nativeType}\n`;
	});

	return `\n${columns.join("")}`;
}

const prisma = defineAddon<ForgeConfig, "prisma", "nextjs">({
	id: "prisma",
	name: "Prisma",
	version: "0.1.0",
	category: "orm",
	exclusive: true,
	dependencies: [{ id: "typescript", type: "addon" }],
	targetMode: "single",
	when: (config) => config.orm === "prisma",
	contribute: ({ config }) => {
		const slug = config.slug ?? "my-app";

		const pm = resolvePackageManager(config);
		const dbPackage = { name: `@${slug}/db`, path: "../../packages/db" };
		const provider = resolveDatabaseProvider(config);

		const usesAuth = config.authentication === "better-auth";
		const envVars = provider.prisma.envVars ?? provider.envVars;
		const emulatesRelations = provider.prisma.relationMode !== undefined;
		const tables = authPluginTables(config);
		const vars = {
			SLUG: slug,
			"__AUTH_USER_RELATIONS__\n": prismaUserRelations(tables),
			"__AUTH_TABLES__\n": renderPrismaAuthTables(
				tables,
				provider.prisma.datasourceProvider,
			),
			DATASOURCE_PROVIDER: provider.prisma.datasourceProvider,
			ENV_RUNTIME: envRuntimeLines(envVars),
			ENV_SERVER: envServerLines(envVars),
			RELATION_MODE: emulatesRelations
				? `\n  relationMode = "${provider.prisma.relationMode}"`
				: "",
			"  // __PASSWORD_FIELD__\n": authUsesPassword(config)
				? "  password              String?__TEXT__\n"
				: "",
			"  // __USER_PLUGIN_FIELDS__\n": prismaAuthFields(
				authPluginFields(config, "user"),
				provider.prisma.datasourceProvider,
			),
			"  // __SESSION_PLUGIN_FIELDS__\n": prismaAuthFields(
				authPluginFields(config, "session"),
				provider.prisma.datasourceProvider,
			),
			TEXT: provider.prisma.datasourceProvider === "mysql" ? " @db.Text" : "",
			TIMESTAMPTZ:
				provider.prisma.datasourceProvider === "postgresql"
					? " @db.Timestamptz"
					: "",
		};

		const render = (path: string) =>
			interpolate(readTemplate(`orm/prisma/${path}`), vars);

		return [
			ensurePackageModule("db", "packages/db", {
				packageType: "library",
				template: { id: "db", version: 1 },
				capabilities: ["db", "prisma"],
				slots: {},
			}),
			surfaceJson(ensuredModuleTarget("db"), "packageJson", {
				name: `@${slug}/db`,
				private: true,
				type: "module",
				exports: {
					".": "./src/index.ts",
					"./client": "./src/client.ts",
					"./env": "./env.ts",
					"./generated/*": "./src/generated/*.ts",
				},
				scripts: {
					generate: "prisma generate",
					migrate: pmRun(pm, "with-env", "prisma migrate dev"),
					push: pmRun(pm, "with-env", "prisma db push"),
					studio: pmRun(pm, "with-env", "prisma studio"),
					typecheck: "tsc --noEmit",
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
				...provider.prisma.runtimeDeps.map((key) => ({
					...catalogRef(key, config),
					type: "dependencies" as const,
				})),
				{ ...deps.t3OssEnvCore, type: "dependencies" },
				{ ...deps.prismaClient, type: "dependencies" },
				{ ...deps.zod, type: "dependencies" },
				{
					name: `@${slug}/tsconfig`,
					version: "workspace:*",
					type: "devDependencies",
				},
				...provider.prisma.devDeps.map((key) => ({
					...catalogRef(key, config),
					type: "devDependencies" as const,
				})),
				{ ...deps.typesNode, type: "devDependencies" },
				{ ...deps.dotenvCli, type: "devDependencies" },
				{ ...deps.prisma, type: "devDependencies" },
				{ ...deps.typescript, type: "devDependencies" },
			]),

			leafTextFile(
				ensuredModuleTarget("db"),
				"env.ts",
				render("packages/db/env.ts"),
			),
			leafTextFile(
				ensuredModuleTarget("db"),
				"prisma.config.ts",
				render(
					`packages/db/prisma.config.${provider.prisma.configTemplate}.ts`,
				),
			),
			leafTextFile(
				ensuredModuleTarget("db"),
				"prisma/schema.prisma",
				render(
					usesAuth
						? "packages/db/prisma/schema.prisma"
						: "packages/db/prisma/schema.base.prisma",
				),
			),
			leafTextFile(
				ensuredModuleTarget("db"),
				"src/client.ts",
				render(`packages/db/src/client.${provider.prisma.clientTemplate}.ts`),
			),
			leafTextFile(
				ensuredModuleTarget("db"),
				"src/index.ts",
				render("packages/db/src/index.ts"),
			),

			...(config.web === undefined
				? []
				: [
						surfaceDependencies(ensuredModuleTarget("web"), "packageJson", [
							{
								name: `@${slug}/db`,
								version: "workspace:*",
								type: "dependencies",
							},
						]),
					]),

			surfaceLines(
				projectTarget(),
				"rootEnv",
				envVars.map(({ name, value }) => envFileLine(name, value)),
				{ section: "Database" },
			),
			surfaceLines(
				projectTarget(),
				"rootEnvExample",
				envVars.map(({ name, example }) => envFileLine(name, example)),
				{ section: "Database" },
			),
			surfaceLines(
				projectTarget(),
				"gitignore",
				[
					"packages/db/src/generated/",
					...(provider.prisma.configTemplate === "local-file"
						? ["/local.db*"]
						: []),
					...(provider.prisma.configTemplate === "turso"
						? ["/packages/db/prisma/local.db*"]
						: []),
				],
				{ section: "Prisma" },
			),

			...(config.web === undefined
				? []
				: [
						surfaceScripts(ensuredModuleTarget("web"), "packageJson", {
							"db:generate": pmRunIn(pm, dbPackage, "generate"),
							"db:migrate": pmRunIn(pm, dbPackage, "migrate"),
							"db:push": pmRunIn(pm, dbPackage, "push"),
							"db:studio": pmRunIn(pm, dbPackage, "studio"),
						}),
					]),

			// The generated client lives in the db package's source tree and is
			// gitignored, so a fresh checkout has to regenerate it on install.
			surfaceScripts(projectTarget(), "rootPackageJson", {
				postinstall: pmRunIn(
					pm,
					{ name: `@${slug}/db`, path: "packages/db" },
					"generate",
				),
			}),
		];
	},
});

export const prismaMetadata = {
	description:
		"Adds Prisma ORM configuration, schema, and database tooling to a compatible app.",
	experimental: false,
	hidden: false,
	id: "prisma",
	keywords: ["database", "orm", "prisma", "sql"],
	kind: "addon",
	name: "Prisma",
	summary: "Add Prisma ORM support.",
} as const satisfies FirstPartyAddonMetadata;

export default prisma;
