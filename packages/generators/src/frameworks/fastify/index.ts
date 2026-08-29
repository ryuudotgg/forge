import {
	defineFramework,
	defineTemplate,
	ensureAppModule,
	ensuredModuleTarget,
	type FrameworkDefinition,
	leafTextFile,
	projectTarget,
	surfaceDependencies,
	surfaceJson,
	surfaceLines,
	surfaceScripts,
	type TemplateDefinition,
} from "@ryuujs/core";
import type { ForgeConfig } from "../../config";
import { envFileLine } from "../../data/providers";
import { deps } from "../../deps";
import { standaloneApiOrigin, webDevOrigin } from "../../origins";
import { pmRun, resolvePackageManager } from "../../pm";
import type {
	FirstPartyFrameworkMetadata,
	FirstPartyTemplateMetadata,
} from "../../registry/types";
import { interpolate, readTemplate } from "../../template";

export const fastifyFramework: FrameworkDefinition<"fastify"> = defineFramework(
	{
		id: "fastify",
		buildOutputs: ["dist/**"],
		ignoreDirs: [],
		name: "Fastify",
		sourceRoot: "src",
		slots: ["api", "trpc", "auth"],
		tsconfigPreset: {
			name: "fastify",
			content: {
				$schema: "https://json.schemastore.org/tsconfig",
				display: "Fastify",
				extends: "./base.json",
				compilerOptions: {
					lib: ["ESNext"],
					module: "ESNext",
					moduleResolution: "Bundler",
					types: ["node"],
				},
			},
		},
	},
);

export const fastifyFrameworkMetadata: FirstPartyFrameworkMetadata = {
	category: "backend",
	description:
		"Forge's first-party Fastify backend framework for standalone Node.js API applications.",
	experimental: false,
	hidden: false,
	id: "fastify",
	keywords: ["api", "backend", "fastify", "framework", "node"],
	kind: "framework",
	name: "Fastify",
	summary: "Managed standalone Fastify API host.",
};

const fastifyBaseTemplate: TemplateDefinition<
	ForgeConfig,
	"fastify/base",
	"fastify"
> = defineTemplate({
	id: "fastify/base",
	framework: "fastify",
	name: "Base",
	version: 1,
	category: "backend",
	dependencies: [
		{ id: "root", type: "addon" },
		{ id: "typescript", type: "addon" },
	],
	when: (config) => config.backend === "fastify",
	contribute: ({ config }) => buildContributions(config),
});

export const fastifyBaseTemplateMetadata: FirstPartyTemplateMetadata = {
	description:
		"A production-ready Fastify Node.js API host that composes with Forge server addons.",
	experimental: false,
	hidden: false,
	id: "fastify/base",
	keywords: ["api", "backend", "base", "fastify", "node", "template"],
	kind: "template",
	name: "Base",
	summary: "Base standalone Fastify backend template.",
};

function buildContributions(config: ForgeConfig) {
	const slug = config.slug ?? "my-app";
	const pm = resolvePackageManager(config);
	const usesTrpc = config.rpc === "trpc";
	const usesAuth = config.authentication === "better-auth";
	const webOrigin = webDevOrigin(config);
	const serverOrigin = standaloneApiOrigin(config) ?? webOrigin;
	const envLines = [
		envFileLine("WEB_URL", webOrigin),
		envFileLine("VITE_SERVER_URL", serverOrigin),
		envFileLine("NEXT_PUBLIC_SERVER_URL", serverOrigin),
	];
	const vars = {
		SLUG: slug,
		WEB_ORIGIN: webOrigin,
		"// __TRPC_IMPORT__\n": usesTrpc
			? 'import { registerTrpcRoutes } from "./routes/trpc.js";\n'
			: "",
		"// __AUTH_IMPORT__\n": usesAuth
			? 'import { registerAuthRoutes } from "./routes/auth.js";\n'
			: "",
		"// __TRPC_ROUTE__\n": usesTrpc ? "registerTrpcRoutes(app);\n" : "",
		"// __AUTH_ROUTE__\n": usesAuth ? "registerAuthRoutes(app);\n" : "",
	};

	return [
		ensureAppModule("server", "apps/server", {
			framework: "fastify",
			template: { id: "fastify/base", version: 1 },
			slots: {
				api: "src/routes",
				trpc: "src/routes/trpc.ts",
				auth: "src/routes/auth.ts",
			},
		}),
		surfaceJson(ensuredModuleTarget("server"), "packageJson", {
			name: `@${slug}/server`,
			version: "0.1.0",
			private: true,
			type: "module",
		}),
		surfaceJson(ensuredModuleTarget("server"), "tsconfig", {
			extends: `@${slug}/tsconfig/fastify.json`,
			compilerOptions: {
				paths: { "@/*": ["./src/*"] },
			},
			include: ["src"],
			exclude: ["node_modules", "dist"],
		}),
		surfaceDependencies(ensuredModuleTarget("server"), "packageJson", [
			{ ...deps.fastify, type: "dependencies" },
			{ ...deps.fastifyCors, type: "dependencies" },
			{ ...deps.t3OssEnvCore, type: "dependencies" },
			{ ...deps.zod, type: "dependencies" },
			{
				name: `@${slug}/tsconfig`,
				version: "workspace:*",
				type: "devDependencies",
			},
			{ ...deps.dotenvCli, type: "devDependencies" },
			{ ...deps.tsdown, type: "devDependencies" },
			{ ...deps.tsx, type: "devDependencies" },
			{ ...deps.typesNode, type: "devDependencies" },
			{ ...deps.typescript, type: "devDependencies" },
		]),
		...(config.orm === "drizzle" && config.database === "sqlite"
			? [
					surfaceDependencies(ensuredModuleTarget("server"), "packageJson", [
						{ ...deps.libsqlClient, type: "dependencies" },
					]),
				]
			: []),
		surfaceScripts(ensuredModuleTarget("server"), "packageJson", {
			build: pmRun(pm, "with-env", "tsdown"),
			dev: pmRun(pm, "with-env", "tsx watch src/index.ts"),
			start: pmRun(pm, "with-env", "node dist/index.js"),
			typecheck: "tsc --noEmit",
			"with-env": "dotenv -e ../../.env --",
		}),
		surfaceLines(projectTarget(), "rootEnv", envLines, {
			section: "Fastify",
		}),
		surfaceLines(projectTarget(), "rootEnvExample", envLines, {
			section: "Fastify",
		}),
		leafTextFile(
			ensuredModuleTarget("server"),
			"src/app.ts",
			interpolate(readTemplate("frameworks/fastify/src/app.ts"), vars),
		),
		leafTextFile(
			ensuredModuleTarget("server"),
			"src/index.ts",
			readTemplate("frameworks/fastify/src/index.ts"),
		),
		leafTextFile(
			ensuredModuleTarget("server"),
			"env.ts",
			interpolate(readTemplate("frameworks/fastify/env.ts"), vars),
		),
		leafTextFile(
			ensuredModuleTarget("server"),
			"tsdown.config.ts",
			interpolate(readTemplate("frameworks/fastify/tsdown.config.ts"), vars),
		),
	];
}

export default fastifyBaseTemplate;
