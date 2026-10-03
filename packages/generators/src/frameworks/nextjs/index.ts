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
import type { ForgeConfig } from "../../config";
import { deps } from "../../deps";
import { nextServerEnvMarkers } from "../../origins";
import { pmRun, resolvePackageManager } from "../../pm";
import type {
	FirstPartyFrameworkMetadata,
	FirstPartyTemplateMetadata,
} from "../../registry/types";
import { rpcDescriptor } from "../../rpc";
import { interpolate, readTemplate } from "../../template";
import { catalogRef } from "../../versions";
import {
	type WebAppInstance,
	webAppInstances,
	webAppRenderConfig,
} from "../../web-apps";

const nextjsSlots = {
	layout: "app/layout.tsx",
	page: "app/page.tsx",
	api: "app/api",
	trpc: "app/api/trpc/[trpc]/route.ts",
	auth: "app/api/auth/[...all]/route.ts",
};

export const nextjsFramework: FrameworkDefinition<"nextjs"> = defineFramework({
	id: "nextjs",
	configFile: "next.config.ts",
	clientEnvPrefix: "NEXT_PUBLIC_",
	buildOutputs: [".next/**", "!.next/cache/**"],
	ignoreDirs: [".next/"],
	name: "Next.js",
	sourceRoot: "",
	slots: Object.keys(nextjsSlots),
	tsconfigPreset: {
		name: "nextjs",
		content: {
			$schema: "https://json.schemastore.org/tsconfig",
			display: "Next.js",
			extends: "./base.json",
			compilerOptions: {
				declaration: false,
				declarationMap: false,
				plugins: [{ name: "next" }],
				module: "ESNext",
				moduleResolution: "Bundler",
				allowJs: true,
				jsx: "preserve",
				noEmit: true,
			},
		},
	},
});

export const nextjsFrameworkMetadata = {
	description:
		"Forge's first-party Next.js host framework with managed app surfaces and slot-aware rendering.",
	experimental: false,
	hidden: false,
	id: "nextjs",
	keywords: ["app", "framework", "next", "react", "web"],
	kind: "framework",
	name: "Next.js",
	summary: "Managed Next.js app host.",
} as const satisfies FirstPartyFrameworkMetadata;

const nextjsBaseTemplate: TemplateDefinition<
	ForgeConfig,
	"nextjs/base",
	"nextjs"
> = defineTemplate({
	id: "nextjs/base",
	framework: "nextjs",
	name: "Base",
	version: 1,
	category: "web",
	dependencies: [
		{ id: "root", type: "addon" },
		{ id: "typescript", type: "addon" },
		{ id: "ui", type: "addon" },
	],
	when: (config) => config.web === "nextjs",
	contribute: ({ config }) =>
		webAppInstances(config)
			.filter((instance) => instance.framework === "nextjs")
			.flatMap((instance) => buildContributions(config, instance)),
});

export const nextjsBaseTemplateMetadata = {
	description:
		"A production-ready Next.js base template that composes cleanly with Forge addons.",
	experimental: false,
	hidden: false,
	id: "nextjs/base",
	keywords: ["base", "next", "starter", "template", "web"],
	kind: "template",
	name: "Base",
	summary: "Base Next.js template.",
} as const satisfies FirstPartyTemplateMetadata;

function buildContributions(config: ForgeConfig, instance: WebAppInstance) {
	const renderConfig = webAppRenderConfig(config, instance);
	const slug = config.slug ?? "my-app";
	const projectName = config.name ?? slug;

	const pm = resolvePackageManager(config);
	const vars = { PROJECT_NAME: projectName, SLUG: slug };

	const transpilePackages = [`@${slug}/ui`];
	if (renderConfig.orm !== undefined) transpilePackages.push(`@${slug}/db`);

	if (renderConfig.rpc !== undefined)
		transpilePackages.push(`@${slug}/${config.rpc}`);

	if (renderConfig.authentication === "better-auth")
		transpilePackages.push(`@${slug}/auth`);

	const transpileList = transpilePackages
		.sort()
		.map((name) => `"${name}"`)
		.join(", ");

	const nextConfig = interpolate(
		readTemplate("frameworks/nextjs/next.config.ts"),
		{ TRANSPILE_PACKAGES: `[${transpileList}]` },
	);

	const webEnv = interpolate(
		readTemplate("frameworks/nextjs/env.ts"),
		nextServerEnvMarkers(renderConfig),
	);

	const webPackageJson: Record<string, unknown> = {
		name: instance.packageName,
		version: "0.1.0",
		private: true,
		type: "module",
	};

	const webTsconfig: Record<string, unknown> = {
		extends: `@${slug}/tsconfig/nextjs.json`,
		compilerOptions: {
			paths: {
				"@/*": ["./*"],
				[`@${slug}/ui/*`]: ["../../packages/ui/src/*"],
			},
			plugins: [{ name: "next" }],
		},
		include: [
			"next-env.d.ts",
			"next.config.ts",
			"**/*.ts",
			"**/*.tsx",
			".next/types/**/*.ts",
		],
		exclude: ["node_modules"],
	};

	const appDeps = [
		{
			name: `@${slug}/ui`,
			version: "workspace:*",
			type: "dependencies" as const,
		},
		{ ...deps.next, type: "dependencies" as const },
		{ ...catalogRef("react", config), type: "dependencies" as const },
		{ ...catalogRef("reactDom", config), type: "dependencies" as const },
		{ ...deps.serverOnly, type: "dependencies" as const },
		{ ...deps.nextThemes, type: "dependencies" as const },
		{ ...deps.zod, type: "dependencies" as const },
		{ ...deps.t3OssEnvNextjs, type: "dependencies" as const },
		{
			name: `@${slug}/tsconfig`,
			version: "workspace:*",
			type: "devDependencies" as const,
		},
		{ ...deps.typesNode, type: "devDependencies" as const },
		{ ...deps.typesReact, type: "devDependencies" as const },
		{ ...deps.typesReactDom, type: "devDependencies" as const },
		{ ...deps.dotenvCli, type: "devDependencies" as const },
		{ ...deps.typescript, type: "devDependencies" as const },
	];

	const rpc = rpcDescriptor(renderConfig);
	const providers = interpolate(
		readTemplate("frameworks/nextjs/app/providers.tsx"),
		{
			PROVIDER_IMPORTS:
				rpc !== undefined
					? `\nimport { ${rpc.client.component} } from "${rpc.client.module}";`
					: "",
			PROVIDER_CHILDREN:
				rpc !== undefined
					? `<${rpc.client.component}>{children}</${rpc.client.component}>`
					: "{children}",
		},
	);

	return [
		ensureAppModule(instance.key, instance.root, {
			framework: "nextjs",
			template: { id: "nextjs/base", version: 1 },
			slots: instance.primary
				? nextjsSlots
				: { layout: nextjsSlots.layout, page: nextjsSlots.page },
			...(instance.role === undefined ? {} : { role: instance.role }),
		}),

		surfaceText(
			ensuredModuleTarget(instance.key),
			"layout",
			interpolate(readTemplate("frameworks/nextjs/app/layout.tsx"), vars),
			{ priority: 0 },
		),
		surfaceText(
			ensuredModuleTarget(instance.key),
			"page",
			interpolate(readTemplate("frameworks/nextjs/app/page.tsx"), vars),
			{ priority: 0 },
		),
		surfaceText(
			ensuredModuleTarget(instance.key),
			"frameworkConfig",
			nextConfig,
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
			build: pmRun(pm, "with-env", "next build"),
			dev: pmRun(
				pm,
				"with-env",
				instance.primary ? "next dev" : `next dev --port ${instance.port}`,
			),
			postinstall: pmRun(pm, "typegen"),
			pretypecheck: pmRun(pm, "with-env", "next typegen"),
			start: pmRun(
				pm,
				"with-env",
				instance.primary ? "next start" : `next start --port ${instance.port}`,
			),
			typecheck: "tsc --noEmit",
			typegen: pmRun(pm, "with-env", "next typegen"),
			"with-env": "dotenv -e ../../.env --",
		}),

		leafTextFile(ensuredModuleTarget(instance.key), "env.ts", webEnv),
		leafTextFile(
			ensuredModuleTarget(instance.key),
			"app/providers.tsx",
			providers,
		),
	];
}

export default nextjsBaseTemplate;
