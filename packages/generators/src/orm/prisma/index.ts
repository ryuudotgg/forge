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
	envFileLine,
	envRuntimeLines,
	envServerLines,
	resolveDatabaseProvider,
} from "../../data/providers";
import { deps } from "../../deps";
import { pmRun, pmRunIn, resolvePackageManager } from "../../pm";
import type { FirstPartyAddonMetadata } from "../../registry/types";
import { interpolate, readTemplate } from "../../template";

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
		const vars = {
			SLUG: slug,
			DATASOURCE_PROVIDER: provider.prisma.datasourceProvider,
			ENV_RUNTIME: envRuntimeLines(envVars),
			ENV_SERVER: envServerLines(envVars),
			RELATION_MODE: emulatesRelations
				? `\n  relationMode = "${provider.prisma.relationMode}"`
				: "",
			RELATION_INDEX: emulatesRelations ? "  @@index([userId])\n\n" : "",
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
				...provider.prisma.runtimeDeps.map((key) => ({
					...deps[key],
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
					...deps[key],
					type: "devDependencies" as const,
				})),
				{ ...deps.typesNode, type: "devDependencies" },
				{ ...deps.typescriptNativePreview, type: "devDependencies" },
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

			surfaceScripts(ensuredModuleTarget("web"), "packageJson", {
				"db:generate": pmRunIn(pm, dbPackage, "generate"),
				"db:migrate": pmRunIn(pm, dbPackage, "migrate"),
				"db:push": pmRunIn(pm, dbPackage, "push"),
				"db:studio": pmRunIn(pm, dbPackage, "studio"),
			}),

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
