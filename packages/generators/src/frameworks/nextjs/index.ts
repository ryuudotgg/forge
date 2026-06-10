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
import { pmRun, resolvePackageManager } from "../../pm";
import type {
	FirstPartyFrameworkMetadata,
	FirstPartyTemplateMetadata,
} from "../../registry/types";
import { interpolate, readTemplate } from "../../template";

export const nextjsFramework: FrameworkDefinition<"nextjs"> = defineFramework({
	id: "nextjs",
	name: "Next.js",
	slots: ["layout", "page", "api", "trpc", "db", "auth", "authClient"],
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
	exclusive: true,
	dependencies: [
		{ id: "root", type: "addon" },
		{ id: "typescript", type: "addon" },
		{ id: "ui", type: "addon" },
	],
	when: (config) => config.web === "nextjs",
	contribute: ({ config }) => buildContributions(config),
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

function buildContributions(config: ForgeConfig) {
	const slug = config.slug ?? "my-app";
	const projectName = config.name ?? slug;

	const pm = resolvePackageManager(config);
	const vars = { PROJECT_NAME: projectName, SLUG: slug };

	const transpilePackages = [`@${slug}/ui`];
	if (config.orm === "drizzle") transpilePackages.push(`@${slug}/db`);
	if (config.authentication === "better-auth")
		transpilePackages.push(`@${slug}/auth`);
	if (config.rpc === "trpc") transpilePackages.push(`@${slug}/trpc`);

	const transpileList = transpilePackages
		.sort()
		.map((name) => `"${name}"`)
		.join(", ");
	const nextConfig = interpolate(
		readTemplate("frameworks/nextjs/next.config.ts"),
		{
			TRANSPILE_PACKAGES: `[${transpileList}]`,
		},
	);

	const webEnv = readTemplate("frameworks/nextjs/env.ts");

	const webPackageJson: Record<string, unknown> = {
		name: `@${slug}/web`,
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
		{ ...deps.react, type: "dependencies" as const },
		{ ...deps.reactDom, type: "dependencies" as const },
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
		{ ...deps.typescriptNativePreview, type: "devDependencies" as const },
		{ ...deps.dotenvCli, type: "devDependencies" as const },
		{ ...deps.typescript, type: "devDependencies" as const },
	];

	const usesTrpc = config.rpc === "trpc";
	const providers = interpolate(
		readTemplate("frameworks/nextjs/app/providers.tsx"),
		{
			PROVIDER_IMPORTS: usesTrpc
				? '\nimport { TRPCReactProvider } from "@/trpc/react";'
				: "",
			PROVIDER_CHILDREN: usesTrpc
				? "<TRPCReactProvider>{children}</TRPCReactProvider>"
				: "{children}",
		},
	);

	return [
		ensureAppModule("web", "apps/web", {
			framework: "nextjs",
			template: { id: "base", version: 1 },
			slots: {
				layout: "app/layout.tsx",
				page: "app/page.tsx",
				api: "app/api",
			},
		}),

		surfaceText(
			ensuredModuleTarget("web"),
			"layout",
			interpolate(readTemplate("frameworks/nextjs/app/layout.tsx"), vars),
			{ priority: 0 },
		),
		surfaceText(
			ensuredModuleTarget("web"),
			"page",
			interpolate(readTemplate("frameworks/nextjs/app/page.tsx"), vars),
			{ priority: 0 },
		),
		surfaceText(ensuredModuleTarget("web"), "frameworkConfig", nextConfig),
		surfaceJson(ensuredModuleTarget("web"), "tsconfig", webTsconfig),
		surfaceJson(ensuredModuleTarget("web"), "packageJson", webPackageJson),
		surfaceDependencies(ensuredModuleTarget("web"), "packageJson", appDeps),
		surfaceScripts(ensuredModuleTarget("web"), "packageJson", {
			build: pmRun(pm, "with-env", "next build"),
			dev: pmRun(pm, "with-env", "next dev"),
			postinstall: pmRun(pm, "typegen"),
			pretypecheck: pmRun(pm, "with-env", "next typegen"),
			start: pmRun(pm, "with-env", "next start"),
			typecheck: "tsgo --noEmit",
			typegen: pmRun(pm, "with-env", "next typegen"),
			"with-env": "dotenv -e ../../.env --",
		}),

		leafTextFile(ensuredModuleTarget("web"), "env.ts", webEnv),
		leafTextFile(ensuredModuleTarget("web"), "app/providers.tsx", providers),
	];
}

export default nextjsBaseTemplate;
