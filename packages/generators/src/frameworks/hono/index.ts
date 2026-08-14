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

export const honoFramework: FrameworkDefinition<"hono"> = defineFramework({
	id: "hono",
	buildOutputs: ["dist/**"],
	ignoreDirs: [],
	name: "Hono",
	sourceRoot: "src",
	slots: ["api", "trpc", "auth"],
	tsconfigPreset: {
		name: "hono",
		content: {
			$schema: "https://json.schemastore.org/tsconfig",
			display: "Hono",
			extends: "./base.json",
			compilerOptions: {
				lib: ["ESNext"],
				module: "ESNext",
				moduleResolution: "Bundler",
				types: ["node"],
			},
		},
	},
});

export const honoFrameworkMetadata: FirstPartyFrameworkMetadata = {
	category: "backend",
	description:
		"Forge's first-party Hono backend framework for standalone Node.js API applications.",
	experimental: false,
	hidden: false,
	id: "hono",
	keywords: ["api", "backend", "framework", "hono", "node"],
	kind: "framework",
	name: "Hono",
	summary: "Managed standalone Hono API host.",
};

const honoBaseTemplate: TemplateDefinition<ForgeConfig, "hono/base", "hono"> =
	defineTemplate({
		id: "hono/base",
		framework: "hono",
		name: "Base",
		version: 1,
		category: "backend",
		dependencies: [
			{ id: "root", type: "addon" },
			{ id: "typescript", type: "addon" },
		],
		when: (config) => config.backend === "hono",
		contribute: ({ config }) => buildContributions(config),
	});

export const honoBaseTemplateMetadata: FirstPartyTemplateMetadata = {
	description:
		"A production-ready Hono Node.js API host that composes with Forge server addons.",
	experimental: false,
	hidden: false,
	id: "hono/base",
	keywords: ["api", "backend", "base", "hono", "node", "template"],
	kind: "template",
	name: "Base",
	summary: "Base standalone Hono backend template.",
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
			? 'import { trpcRoutes } from "./routes/trpc.js";\n'
			: "",
		"// __AUTH_IMPORT__\n": usesAuth
			? 'import { authRoutes } from "./routes/auth.js";\n'
			: "",
		"// __TRPC_ROUTE__\n": usesTrpc ? 'app.route("/", trpcRoutes);\n' : "",
		"// __AUTH_ROUTE__\n": usesAuth ? 'app.route("/", authRoutes);\n' : "",
	};

	return [
		ensureAppModule("server", "apps/server", {
			framework: "hono",
			template: { id: "hono/base", version: 1 },
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
			extends: `@${slug}/tsconfig/hono.json`,
			compilerOptions: {
				paths: { "@/*": ["./src/*"] },
			},
			include: ["src"],
			exclude: ["node_modules", "dist"],
		}),
		surfaceDependencies(ensuredModuleTarget("server"), "packageJson", [
			{ ...deps.honoNodeServer, type: "dependencies" },
			{ ...deps.hono, type: "dependencies" },
			{ ...deps.t3OssEnvCore, type: "dependencies" },
			{ ...deps.zod, type: "dependencies" },
			...(config.orm === "drizzle" && config.database === "sqlite"
				? [{ ...deps.libsqlClient, type: "dependencies" as const }]
				: []),
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
		surfaceScripts(ensuredModuleTarget("server"), "packageJson", {
			build: pmRun(pm, "with-env", "tsdown"),
			dev: pmRun(pm, "with-env", "tsx watch src/index.ts"),
			start: pmRun(pm, "with-env", "node dist/index.js"),
			typecheck: "tsc --noEmit",
			"with-env": "dotenv -e ../../.env --",
		}),
		surfaceLines(projectTarget(), "rootEnv", envLines, { section: "Hono" }),
		surfaceLines(projectTarget(), "rootEnvExample", envLines, {
			section: "Hono",
		}),
		leafTextFile(
			ensuredModuleTarget("server"),
			"src/app.ts",
			interpolate(readTemplate("frameworks/hono/src/app.ts"), vars),
		),
		leafTextFile(
			ensuredModuleTarget("server"),
			"src/index.ts",
			readTemplate("frameworks/hono/src/index.ts"),
		),
		leafTextFile(
			ensuredModuleTarget("server"),
			"env.ts",
			interpolate(readTemplate("frameworks/hono/env.ts"), vars),
		),
		leafTextFile(
			ensuredModuleTarget("server"),
			"tsdown.config.ts",
			interpolate(readTemplate("frameworks/hono/tsdown.config.ts"), vars),
		),
	];
}

export default honoBaseTemplate;
