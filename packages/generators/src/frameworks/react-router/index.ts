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
import type { ForgeConfig, RpcProvider } from "../../config";
import { deps } from "../../deps";
import { viteServerEnvMarkers } from "../../origins";
import { pmRun, resolvePackageManager } from "../../pm";
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

const reactRouterSlots = {
	layout: "app/root.tsx",
	page: "app/routes/home.tsx",
	api: "app/routes/api",
	trpc: "app/routes/api.trpc.$.ts",
	auth: "app/routes/api.auth.$.ts",
};

const reactRouterRpcRoutes: { readonly [Id in RpcProvider]: string } = {
	trpc: '  route("api/trpc/*", "routes/api.trpc.$.ts"),\n',
	orpc: '  route("api/orpc/*", "routes/api.orpc.$.ts"),\n',
};

export const reactRouterFramework: FrameworkDefinition<"react-router"> =
	defineFramework({
		id: "react-router",
		configFile: "react-router.config.ts",
		clientEnvPrefix: "VITE_",
		buildOutputs: ["build/**"],
		ignoreDirs: [".react-router/"],
		name: "React Router",
		sourceRoot: "app",
		slots: Object.keys(reactRouterSlots),
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
	when: (config) =>
		webAppInstances(config).some(
			(instance) => instance.framework === "react-router",
		),
	contribute: ({ config }) =>
		webAppInstances(config)
			.filter((instance) => instance.framework === "react-router")
			.flatMap((instance) => buildContributions(config, instance)),
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

function buildContributions(config: ForgeConfig, instance: WebAppInstance) {
	const renderConfig = webAppRenderConfig(config, instance);
	const slug = config.slug ?? "my-app";
	const projectName = config.name ?? slug;

	const pm = resolvePackageManager(config);

	const useTailwind = config.style === "tailwind";
	const rpc = rpcDescriptor(renderConfig);
	const usesAuth = renderConfig.authentication === "better-auth";
	const servesApiRoutes =
		renderConfig.rpc !== "orpc" ||
		renderConfig.backend === undefined ||
		renderConfig.backend === "self";

	const vars = { PROJECT_NAME: projectName, SLUG: slug };

	const providersTemplate = readTemplate(
		"frameworks/react-router/app/providers.tsx",
	);

	const providers = interpolate(
		renderConfig.rpc === undefined
			? providersTemplate
			: rpcProviderTemplate(providersTemplate, renderConfig.rpc),
		{
			"// __TRPC_IMPORT__\n":
				rpc !== undefined
					? `import { ${rpc.client.component} } from "${rpc.client.module}";\n`
					: "",
			"  // __TRPC_ENTRY__\n":
				rpc !== undefined ? `  ${config.rpc}: ${rpc.client.component},\n` : "",
		},
	);

	const routes = interpolate(
		readTemplate("frameworks/react-router/app/routes.ts"),
		{
			ROUTE_IMPORT:
				servesApiRoutes && (rpc !== undefined || usesAuth) ? ", route" : "",
			"// __TRPC_ROUTE__\n":
				renderConfig.rpc !== undefined && servesApiRoutes
					? reactRouterRpcRoutes[renderConfig.rpc]
					: "",
			"// __AUTH_ROUTE__\n":
				usesAuth && servesApiRoutes
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
		name: instance.packageName,
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
		{ ...catalogRef("react", config), type: "dependencies" },
		{ ...catalogRef("reactDom", config), type: "dependencies" },
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
		ensureAppModule(instance.key, instance.root, {
			framework: "react-router",
			template: { id: "react-router/base", version: 1 },
			slots: instance.primary
				? reactRouterSlots
				: { layout: reactRouterSlots.layout, page: reactRouterSlots.page },
			...(instance.role === undefined ? {} : { role: instance.role }),
		}),

		surfaceText(
			ensuredModuleTarget(instance.key),
			"layout",
			interpolate(readTemplate("frameworks/react-router/app/root.tsx"), vars),
			{ priority: 0 },
		),
		surfaceText(
			ensuredModuleTarget(instance.key),
			"page",
			interpolate(
				readTemplate("frameworks/react-router/app/routes/home.tsx"),
				vars,
			),
			{ priority: 0 },
		),
		surfaceText(
			ensuredModuleTarget(instance.key),
			"frameworkConfig",
			readTemplate("frameworks/react-router/react-router.config.ts"),
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
			build: pmRun(pm, "with-env", "react-router build"),
			dev: pmRun(
				pm,
				"with-env",
				instance.primary
					? "react-router dev"
					: `react-router dev --port ${instance.port}`,
			),
			postinstall: pmRun(pm, "typegen"),
			pretypecheck: pmRun(pm, "with-env", "react-router typegen"),
			start: instance.primary
				? pmRun(pm, "with-env", "react-router-serve ./build/server/index.js")
				: `dotenv -e ../../.env -v PORT=${instance.port} -- react-router-serve ./build/server/index.js`,
			typecheck: "tsc --noEmit",
			typegen: pmRun(pm, "with-env", "react-router typegen"),
			"with-env": "dotenv -e ../../.env --",
		}),

		leafTextFile(
			ensuredModuleTarget(instance.key),
			"env.ts",
			interpolate(
				readTemplate("frameworks/react-router/env.ts"),
				viteServerEnvMarkers(renderConfig),
			),
		),
		leafTextFile(
			ensuredModuleTarget(instance.key),
			"app/providers.tsx",
			providers,
		),
		leafTextFile(ensuredModuleTarget(instance.key), "app/routes.ts", routes),
		leafTextFile(
			ensuredModuleTarget(instance.key),
			"vite.config.ts",
			viteConfig,
		),
		leafTextFile(
			ensuredModuleTarget(instance.key),
			"public/favicon.svg",
			readTemplate("frameworks/react-router/public/favicon.svg"),
		),
	];
}

export default reactRouterBaseTemplate;
