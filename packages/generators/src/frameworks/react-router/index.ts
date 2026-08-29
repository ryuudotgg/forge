import {
	defineFramework,
	defineTemplate,
	ensureAppModule,
	ensuredModuleTarget,
	type FrameworkDefinition,
	leafTextFile,
	surfaceDependencies,
	surfaceJson,
	surfaceScripts,
	surfaceText,
	type TemplateDefinition,
} from "@ryuujs/core";
import type { ForgeConfig } from "../../config";
import { deps } from "../../deps";
import { viteServerEnvMarkers } from "../../origins";
import { pmRun, resolvePackageManager } from "../../pm";
import type {
	FirstPartyFrameworkMetadata,
	FirstPartyTemplateMetadata,
} from "../../registry/types";
import { interpolate, readTemplate } from "../../template";

export const reactRouterFramework: FrameworkDefinition<"react-router"> =
	defineFramework({
		id: "react-router",
		configFile: "react-router.config.ts",
		clientEnvPrefix: "VITE_",
		buildOutputs: ["build/**"],
		ignoreDirs: [".react-router/"],
		name: "React Router",
		sourceRoot: "app",
		slots: ["layout", "page", "api", "trpc", "auth"],
		tsconfigPreset: {
			name: "react-router",
			content: {
				$schema: "https://json.schemastore.org/tsconfig",
				display: "React Router",
				extends: "./base.json",
				compilerOptions: {
					declaration: false,
					declarationMap: false,
					jsx: "react-jsx",
					lib: ["DOM", "DOM.Iterable", "ES2022"],
					module: "ES2022",
					moduleResolution: "Bundler",
					noEmit: true,
					target: "ES2022",
					types: ["node", "vite/client"],
				},
			},
		},
	});

export const reactRouterFrameworkMetadata: FirstPartyFrameworkMetadata = {
	description:
		"Forge's first-party React Router host framework with managed app surfaces and slot-aware rendering.",
	experimental: false,
	hidden: false,
	id: "react-router",
	keywords: ["app", "framework", "react", "router", "web"],
	kind: "framework",
	name: "React Router",
	summary: "Managed React Router app host.",
};

const reactRouterBaseTemplate: TemplateDefinition<
	ForgeConfig,
	"react-router/base",
	"react-router"
> = defineTemplate({
	id: "react-router/base",
	framework: "react-router",
	name: "Base",
	version: 1,
	category: "web",
	dependencies: [
		{ id: "root", type: "addon" },
		{ id: "typescript", type: "addon" },
		{ id: "ui", type: "addon" },
	],
	when: (config) => config.web === "react-router",
	contribute: ({ config }) => buildContributions(config),
});

export const reactRouterBaseTemplateMetadata: FirstPartyTemplateMetadata = {
	description:
		"A production-ready React Router base template that composes cleanly with Forge addons.",
	experimental: false,
	hidden: false,
	id: "react-router/base",
	keywords: ["base", "react", "router", "starter", "template", "web"],
	kind: "template",
	name: "Base",
	summary: "Base React Router template.",
};

function buildContributions(config: ForgeConfig) {
	const slug = config.slug ?? "my-app";
	const projectName = config.name ?? slug;

	const pm = resolvePackageManager(config);

	const useTailwind = config.style === "tailwind";
	const usesTrpc = config.rpc === "trpc";
	const usesAuth = config.authentication === "better-auth";

	const vars = { PROJECT_NAME: projectName, SLUG: slug };

	const providers = interpolate(
		readTemplate("frameworks/react-router/app/providers.tsx"),
		{
			"// __TRPC_IMPORT__\n": usesTrpc
				? 'import { TRPCReactProvider } from "@/trpc/react";\n'
				: "",
			"  // __TRPC_ENTRY__\n": usesTrpc ? "  trpc: TRPCReactProvider,\n" : "",
		},
	);

	const routes = interpolate(
		readTemplate("frameworks/react-router/app/routes.ts"),
		{
			ROUTE_IMPORT: usesTrpc || usesAuth ? ", route" : "",
			"// __TRPC_ROUTE__\n": usesTrpc
				? '  route("api/trpc/*", "routes/api.trpc.$.ts"),\n'
				: "",
			"// __AUTH_ROUTE__\n": usesAuth
				? '  route("api/auth/*", "routes/api.auth.$.ts"),\n'
				: "",
		},
	);

	const viteConfig = interpolate(
		readTemplate("frameworks/react-router/vite.config.ts"),
		{
			"// __TAILWIND_IMPORT__\n": useTailwind
				? 'import tailwindcss from "@tailwindcss/vite";\n'
				: "",
			"/* __TAILWIND_PLUGIN__ */ ": useTailwind ? "tailwindcss(), " : "",
		},
	);

	const webPackageJson: Record<string, unknown> = {
		name: `@${slug}/web`,
		version: "0.1.0",
		private: true,
		type: "module",
	};

	const webTsconfig: Record<string, unknown> = {
		extends: `@${slug}/tsconfig/react-router.json`,
		compilerOptions: {
			paths: {
				"@/*": ["./app/*"],
				[`@${slug}/ui/*`]: ["../../packages/ui/src/*"],
			},
			rootDirs: [".", "./.react-router/types"],
		},
		include: [
			"**/*",
			"**/.server/**/*",
			"**/.client/**/*",
			".react-router/types/**/*",
		],
	};

	const appDeps: Array<{
		name: string;
		version: string;
		catalog?: string;
		type: "dependencies" | "devDependencies";
	}> = [
		{
			name: `@${slug}/ui`,
			version: "workspace:*",
			type: "dependencies",
		},
		{ ...deps.react, type: "dependencies" },
		{ ...deps.reactDom, type: "dependencies" },
		{ ...deps.reactRouter, type: "dependencies" },
		{ ...deps.reactRouterNode, type: "dependencies" },
		{ ...deps.reactRouterServe, type: "dependencies" },
		{ ...deps.isbot, type: "dependencies" },
		{ ...deps.nextThemes, type: "dependencies" },
		{ ...deps.t3OssEnvCore, type: "dependencies" },
		{ ...deps.zod, type: "dependencies" },
		{
			name: `@${slug}/tsconfig`,
			version: "workspace:*",
			type: "devDependencies",
		},
		{ ...deps.reactRouterDev, type: "devDependencies" },
		{ ...deps.vite, type: "devDependencies" },
		{ ...deps.typesNode, type: "devDependencies" },
		{ ...deps.typesReact, type: "devDependencies" },
		{ ...deps.typesReactDom, type: "devDependencies" },
		{ ...deps.dotenvCli, type: "devDependencies" },
		{ ...deps.typescript, type: "devDependencies" },
	];

	return [
		ensureAppModule("web", "apps/web", {
			framework: "react-router",
			template: { id: "react-router/base", version: 1 },
			slots: {
				layout: "app/root.tsx",
				page: "app/routes/home.tsx",
				api: "app/routes/api",
				trpc: "app/routes/api.trpc.$.ts",
				auth: "app/routes/api.auth.$.ts",
			},
		}),

		surfaceText(
			ensuredModuleTarget("web"),
			"layout",
			interpolate(readTemplate("frameworks/react-router/app/root.tsx"), vars),
			{ priority: 0 },
		),
		surfaceText(
			ensuredModuleTarget("web"),
			"page",
			interpolate(
				readTemplate("frameworks/react-router/app/routes/home.tsx"),
				vars,
			),
			{ priority: 0 },
		),
		surfaceText(
			ensuredModuleTarget("web"),
			"frameworkConfig",
			readTemplate("frameworks/react-router/react-router.config.ts"),
		),
		surfaceJson(ensuredModuleTarget("web"), "tsconfig", webTsconfig),
		surfaceJson(ensuredModuleTarget("web"), "packageJson", webPackageJson),
		surfaceDependencies(ensuredModuleTarget("web"), "packageJson", appDeps),
		surfaceScripts(ensuredModuleTarget("web"), "packageJson", {
			build: pmRun(pm, "with-env", "react-router build"),
			dev: pmRun(pm, "with-env", "react-router dev"),
			postinstall: pmRun(pm, "typegen"),
			pretypecheck: pmRun(pm, "with-env", "react-router typegen"),
			start: pmRun(
				pm,
				"with-env",
				"react-router-serve ./build/server/index.js",
			),
			typecheck: "tsc --noEmit",
			typegen: pmRun(pm, "with-env", "react-router typegen"),
			"with-env": "dotenv -e ../../.env --",
		}),

		leafTextFile(
			ensuredModuleTarget("web"),
			"env.ts",
			interpolate(
				readTemplate("frameworks/react-router/env.ts"),
				viteServerEnvMarkers(config),
			),
		),
		leafTextFile(ensuredModuleTarget("web"), "app/providers.tsx", providers),
		leafTextFile(ensuredModuleTarget("web"), "app/routes.ts", routes),
		leafTextFile(ensuredModuleTarget("web"), "vite.config.ts", viteConfig),
		leafTextFile(
			ensuredModuleTarget("web"),
			"public/favicon.svg",
			readTemplate("frameworks/react-router/public/favicon.svg"),
		),
	];
}

export default reactRouterBaseTemplate;
