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
} from "@ryuugg/core";
import {
	selfHostedCorsContributions,
	selfHostedCorsViteConfig,
} from "../../client-cors";
import type { ForgeConfig } from "../../config";
import { deps } from "../../deps";
import { viteServerEnvMarkers } from "../../origins";
import { installHook, pmRun, resolvePackageManager } from "../../pm";
import type {
	FirstPartyFrameworkMetadata,
	FirstPartyTemplateMetadata,
} from "../../registry/types";
import { rpcDescriptor, rpcProviderTemplate } from "../../rpc";
import { interpolate, readTemplate } from "../../template";
import { catalogRef } from "../../versions";
import {
	type WebAppInstance,
	webAppInstances,
	webAppRenderConfig,
} from "../../web-apps";

const tanstackStartSlots = {
	layout: "src/routes/__root.tsx",
	page: "src/routes/index.tsx",
	api: "src/routes/api",
	trpc: "src/routes/api/trpc/$.ts",
	auth: "src/routes/api/auth/$.ts",
};

export const tanstackStartFramework: FrameworkDefinition<"tanstack-start"> =
	defineFramework({
		id: "tanstack-start",
		configFile: "vite.config.ts",
		clientEnvPrefix: "VITE_",
		buildOutputs: ["dist/**"],
		ignoreDirs: [".tanstack/"],
		name: "TanStack Start",
		sourceRoot: "src",
		slots: [...Object.keys(tanstackStartSlots), "orpc"],
		tsconfigPreset: {
			name: "tanstack-start",
			content: {
				$schema: "https://json.schemastore.org/tsconfig",
				display: "TanStack Start",
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

export const tanstackStartFrameworkMetadata: FirstPartyFrameworkMetadata = {
	description:
		"Forge's first-party TanStack Start host framework with managed app surfaces and slot-aware rendering.",
	experimental: false,
	hidden: false,
	id: "tanstack-start",
	keywords: ["app", "framework", "react", "start", "tanstack", "web"],
	kind: "framework",
	name: "TanStack Start",
	summary: "Managed TanStack Start app host.",
};

const tanstackStartBaseTemplate: TemplateDefinition<
	ForgeConfig,
	"tanstack-start/base",
	"tanstack-start"
> = defineTemplate({
	id: "tanstack-start/base",
	framework: "tanstack-start",
	name: "Base",
	version: 1,
	category: "web",
	dependencies: [
		{ id: "root", type: "addon" },
		{ id: "typescript", type: "addon" },
		{ id: "ui", type: "addon" },
	],
	when: (config) =>
		webAppInstances(config).some(
			(instance) => instance.framework === "tanstack-start",
		),
	contribute: ({ config }) =>
		webAppInstances(config)
			.filter((instance) => instance.framework === "tanstack-start")
			.flatMap((instance) => buildContributions(config, instance)),
});

export const tanstackStartBaseTemplateMetadata: FirstPartyTemplateMetadata = {
	description:
		"A production-ready TanStack Start base template that composes cleanly with Forge addons.",
	experimental: false,
	hidden: false,
	id: "tanstack-start/base",
	keywords: ["base", "start", "starter", "tanstack", "template", "web"],
	kind: "template",
	name: "Base",
	summary: "Base TanStack Start template.",
};

function buildContributions(config: ForgeConfig, instance: WebAppInstance) {
	const renderConfig = webAppRenderConfig(config, instance);
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

	const rpc = rpcDescriptor(renderConfig);

	const providersTemplate = readTemplate(
		"frameworks/tanstack-start/src/providers.tsx",
	);

	const providers = interpolate(
		renderConfig.rpc === undefined
			? providersTemplate
			: rpcProviderTemplate(providersTemplate, renderConfig.rpc),
		{
			SLUG: slug,
			"// __TRPC_IMPORT__\n":
				rpc !== undefined
					? `import { ${rpc.client.component} } from "${rpc.client.module}";\n`
					: "",
			"  // __TRPC_ENTRY__\n":
				rpc !== undefined ? `  ${config.rpc}: ${rpc.client.component},\n` : "",
		},
	);

	const webPackageJson: Record<string, unknown> = {
		name: instance.packageName,
		version: "0.1.0",
		private: true,
		type: "module",
		imports: { "#/*": "./src/*" },
	};

	const webTsconfig: Record<string, unknown> = {
		extends: `@${slug}/tsconfig/tanstack-start.json`,
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
		{ ...deps.tanstackReactStart, type: "dependencies" },
		{ ...deps.srvx, type: "dependencies" },
		{ ...catalogRef("react", config), type: "dependencies" },
		{ ...catalogRef("reactDom", config), type: "dependencies" },
		{ ...deps.nextThemes, type: "dependencies" },
		{ ...deps.t3OssEnvCore, type: "dependencies" },
		{ ...deps.zod, type: "dependencies" },
		{
			name: `@${slug}/tsconfig`,
			version: "workspace:*",
			type: "devDependencies",
		},
		{ ...deps.tanstackRouterCli, type: "devDependencies" },
		{ ...deps.vite, type: "devDependencies" },
		{ ...deps.viteReact, type: "devDependencies" },
		{ ...deps.typesNode, type: "devDependencies" },
		{ ...deps.typesReact, type: "devDependencies" },
		{ ...deps.typesReactDom, type: "devDependencies" },
		{ ...deps.dotenvCli, type: "dependencies" },
		{ ...deps.typescript, type: "devDependencies" },
	];

	return [
		ensureAppModule(instance.key, instance.root, {
			framework: "tanstack-start",
			template: { id: "tanstack-start/base", version: 1 },
			slots: instance.primary
				? {
						...tanstackStartSlots,
						...(renderConfig.rpc === "orpc"
							? { orpc: "src/routes/api/orpc/$.ts" }
							: {}),
					}
				: { layout: tanstackStartSlots.layout, page: tanstackStartSlots.page },
			...(instance.role === undefined ? {} : { role: instance.role }),
		}),

		surfaceText(
			ensuredModuleTarget(instance.key),
			"layout",
			interpolate(
				readTemplate("frameworks/tanstack-start/src/routes/__root.tsx"),
				vars,
			),
			{ priority: 0 },
		),
		surfaceText(
			ensuredModuleTarget(instance.key),
			"page",
			interpolate(
				readTemplate("frameworks/tanstack-start/src/routes/index.tsx"),
				vars,
			),
			{ priority: 0 },
		),
		surfaceText(
			ensuredModuleTarget(instance.key),
			"frameworkConfig",
			selfHostedCorsViteConfig(
				config,
				instance,
				interpolate(
					readTemplate("frameworks/tanstack-start/vite.config.ts"),
					vars,
				),
			),
		),
		surfaceJson(ensuredModuleTarget(instance.key), "tsconfig", webTsconfig),
		surfaceJson(
			ensuredModuleTarget(instance.key),
			"packageJson",
			webPackageJson,
		),
		surfaceDependencies(
			ensuredModuleTarget(instance.key),
			"packageJson",
			appDeps,
		),
		surfaceScripts(ensuredModuleTarget(instance.key), "packageJson", {
			build: pmRun(pm, "with-env", "vite build"),
			dev: pmRun(pm, "with-env", `vite dev --port ${instance.port}`),
			"generate-routes": "tsr generate",
			postinstall: installHook(
				"@tanstack/router-cli",
				pmRun(pm, "generate-routes"),
			),
			pretypecheck: pmRun(pm, "generate-routes"),
			preview: pmRun(pm, "with-env", "vite preview"),
			start:
				"dotenv -e .env.production -e ../../.env -v NODE_ENV=production -- srvx --prod -s ../client dist/server/server.js",
			typecheck: "tsc --noEmit",
			"with-env": "dotenv -e ../../.env --",
		}),

		leafTextFile(
			ensuredModuleTarget(instance.key),
			"env.ts",
			interpolate(
				readTemplate("frameworks/tanstack-start/env.ts"),
				viteServerEnvMarkers(config, instance),
			),
		),
		leafTextFile(
			ensuredModuleTarget(instance.key),
			".env.production",
			`PORT=${instance.port}\n`,
		),
		leafTextFile(
			ensuredModuleTarget(instance.key),
			"src/providers.tsx",
			providers,
		),
		leafTextFile(
			ensuredModuleTarget(instance.key),
			"src/router.tsx",
			readTemplate("frameworks/tanstack-start/src/router.tsx"),
		),
		leafTextFile(
			ensuredModuleTarget(instance.key),
			"src/routeTree.gen.ts",
			readTemplate("frameworks/tanstack-start/src/routeTree.gen.ts"),
			{ preserveExisting: true },
		),
		...selfHostedCorsContributions(config, instance),
	];
}

export default tanstackStartBaseTemplate;
