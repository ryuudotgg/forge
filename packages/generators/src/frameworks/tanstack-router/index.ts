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

export const tanstackRouterFramework: FrameworkDefinition<"tanstack-router"> =
	defineFramework({
		id: "tanstack-router",
		configFile: "vite.config.ts",
		buildOutputs: ["dist/**"],
		ignoreDirs: [".tanstack/"],
		name: "TanStack Router",
		sourceRoot: "src",
		slots: ["layout", "page"],
		tsconfigPreset: {
			name: "tanstack-router",
			content: {
				$schema: "https://json.schemastore.org/tsconfig",
				display: "TanStack Router",
				extends: "./base.json",
				compilerOptions: {
					allowImportingTsExtensions: true,
					declaration: false,
					declarationMap: false,
					jsx: "react-jsx",
					noEmit: true,
					types: ["vite/client"],
				},
			},
		},
	});

export const tanstackRouterFrameworkMetadata: FirstPartyFrameworkMetadata = {
	description:
		"Forge's first-party TanStack Router host framework for client-only single-page apps with managed app surfaces and slot-aware rendering.",
	experimental: false,
	hidden: false,
	id: "tanstack-router",
	keywords: ["app", "framework", "react", "router", "spa", "tanstack", "web"],
	kind: "framework",
	name: "TanStack Router",
	summary: "Managed TanStack Router single-page app host.",
};

const tanstackRouterBaseTemplate: TemplateDefinition<
	ForgeConfig,
	"tanstack-router/base",
	"tanstack-router"
> = defineTemplate({
	id: "tanstack-router/base",
	framework: "tanstack-router",
	name: "Base",
	version: 1,
	category: "web",
	dependencies: [
		{ id: "root", type: "addon" },
		{ id: "typescript", type: "addon" },
		{ id: "ui", type: "addon" },
	],
	when: (config) => config.web === "tanstack-router",
	contribute: ({ config }) => buildContributions(config),
});

export const tanstackRouterBaseTemplateMetadata: FirstPartyTemplateMetadata = {
	description:
		"A production-ready TanStack Router single-page app base template that composes cleanly with Forge addons.",
	experimental: false,
	hidden: false,
	id: "tanstack-router/base",
	keywords: ["base", "router", "spa", "starter", "tanstack", "template", "web"],
	kind: "template",
	name: "Base",
	summary: "Base TanStack Router template.",
};

function buildContributions(config: ForgeConfig) {
	const slug = config.slug ?? "my-app";
	const projectName = config.name ?? slug;
	const pm = resolvePackageManager(config);
	const useTailwind = config.style === "tailwind";
	const vars = {
		PROJECT_NAME: projectName,
		SLUG: slug,
		"// __TAILWIND_IMPORT__\n": useTailwind
			? 'import tailwindcss from "@tailwindcss/vite";\n'
			: "",
		"/* __TAILWIND_PLUGIN__ */ ": useTailwind ? "tailwindcss(), " : "",
	};
	const usesTrpc = config.rpc === "trpc";

	const providers = interpolate(
		readTemplate("frameworks/tanstack-router/src/providers.tsx"),
		{
			"// __TRPC_IMPORT__\n": usesTrpc
				? 'import { TRPCReactProvider } from "@/trpc/react";\n'
				: "",
			"  // __TRPC_ENTRY__\n": usesTrpc ? "  trpc: TRPCReactProvider,\n" : "",
		},
	);

	const webPackageJson: Record<string, unknown> = {
		name: `@${slug}/web`,
		version: "0.1.0",
		private: true,
		type: "module",
		imports: { "#/*": "./src/*" },
	};

	const webTsconfig: Record<string, unknown> = {
		extends: `@${slug}/tsconfig/tanstack-router.json`,
		compilerOptions: {
			paths: {
				"@/*": ["./src/*"],
				[`@${slug}/ui/*`]: ["../../packages/ui/src/*"],
			},
		},
		include: ["src/**/*.ts", "src/**/*.tsx", "vite.config.ts"],
		exclude: ["node_modules", "dist", ".tanstack"],
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
		{ ...deps.tanstackReactRouter, type: "dependencies" },
		{ ...deps.react, type: "dependencies" },
		{ ...deps.reactDom, type: "dependencies" },
		{ ...deps.nextThemes, type: "dependencies" },
		{ ...deps.t3OssEnvCore, type: "dependencies" },
		{ ...deps.zod, type: "dependencies" },
		{
			name: `@${slug}/tsconfig`,
			version: "workspace:*",
			type: "devDependencies",
		},
		{ ...deps.tanstackRouterCli, type: "devDependencies" },
		{ ...deps.tanstackRouterPlugin, type: "devDependencies" },
		{ ...deps.vite, type: "devDependencies" },
		{ ...deps.viteReact, type: "devDependencies" },
		{ ...deps.typesNode, type: "devDependencies" },
		{ ...deps.typesReact, type: "devDependencies" },
		{ ...deps.typesReactDom, type: "devDependencies" },
		{ ...deps.dotenvCli, type: "devDependencies" },
		{ ...deps.typescript, type: "devDependencies" },
	];

	return [
		ensureAppModule("web", "apps/web", {
			framework: "tanstack-router",
			template: { id: "tanstack-router/base", version: 1 },
			slots: {
				layout: "src/routes/__root.tsx",
				page: "src/routes/index.tsx",
			},
		}),

		surfaceText(
			ensuredModuleTarget("web"),
			"layout",
			interpolate(
				readTemplate("frameworks/tanstack-router/src/routes/__root.tsx"),
				vars,
			),
			{ priority: 0 },
		),
		surfaceText(
			ensuredModuleTarget("web"),
			"page",
			interpolate(
				readTemplate("frameworks/tanstack-router/src/routes/index.tsx"),
				vars,
			),
			{ priority: 0 },
		),
		surfaceText(
			ensuredModuleTarget("web"),
			"frameworkConfig",
			interpolate(
				readTemplate("frameworks/tanstack-router/vite.config.ts"),
				vars,
			),
		),
		surfaceJson(ensuredModuleTarget("web"), "tsconfig", webTsconfig),
		surfaceJson(ensuredModuleTarget("web"), "packageJson", webPackageJson),
		surfaceDependencies(ensuredModuleTarget("web"), "packageJson", appDeps),
		surfaceScripts(ensuredModuleTarget("web"), "packageJson", {
			build: pmRun(pm, "with-env", "vite build"),
			dev: pmRun(pm, "with-env", "vite dev --port 3000"),
			"generate-routes": "tsr generate",
			postinstall: pmRun(pm, "generate-routes"),
			pretypecheck: pmRun(pm, "generate-routes"),
			preview: pmRun(pm, "with-env", "vite preview"),
			typecheck: "tsc --noEmit",
			"with-env": "dotenv -e ../../.env --",
		}),

		leafTextFile(
			ensuredModuleTarget("web"),
			"env.ts",
			interpolate(
				readTemplate("frameworks/tanstack-router/env.ts"),
				viteServerEnvMarkers(config),
			),
		),
		leafTextFile(
			ensuredModuleTarget("web"),
			"index.html",
			interpolate(readTemplate("frameworks/tanstack-router/index.html"), vars),
		),
		leafTextFile(
			ensuredModuleTarget("web"),
			"src/main.tsx",
			readTemplate("frameworks/tanstack-router/src/main.tsx"),
		),
		leafTextFile(ensuredModuleTarget("web"), "src/providers.tsx", providers),
		leafTextFile(
			ensuredModuleTarget("web"),
			"src/router.tsx",
			readTemplate("frameworks/tanstack-router/src/router.tsx"),
		),
		leafTextFile(
			ensuredModuleTarget("web"),
			"src/routeTree.gen.ts",
			readTemplate("frameworks/tanstack-router/src/routeTree.gen.ts"),
		),
	];
}

export default tanstackRouterBaseTemplate;
