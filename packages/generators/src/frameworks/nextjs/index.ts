import {
	defineFramework,
	defineTemplate,
	ensureAppModule,
	ensuredModuleTarget,
	type FrameworkDefinition,
	surfaceDependencies,
	surfaceJson,
	surfaceScripts,
	surfaceText,
	type TemplateDefinition,
} from "@ryuujs/core";
import type { ForgeConfig } from "../../config";
import { deps } from "../../deps";
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
	const vars = { PROJECT_NAME: projectName, SLUG: slug };

	return [
		ensureAppModule("web", "apps/web", {
			framework: "nextjs",
			template: { id: "base", version: 1 },
			slots: {
				layout: "app/layout.tsx",
				page: "app/page.tsx",
				api: "app/api",
				trpc: "src/trpc",
				db: "src/db",
				auth: "src/lib/auth.ts",
				authClient: "src/lib/auth-client.ts",
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
		surfaceText(
			ensuredModuleTarget("web"),
			"frameworkConfig",
			readTemplate("frameworks/nextjs/next.config.ts"),
		),
		surfaceJson(ensuredModuleTarget("web"), "tsconfig", {
			extends: "../../tsconfig.json",
			compilerOptions: {
				jsx: "preserve",
				jsxImportSource: "react",
				paths: { "~/*": ["./src/*"] },
				plugins: [{ name: "next" }],
			},
			include: ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
			exclude: ["node_modules"],
		}),
		surfaceDependencies(ensuredModuleTarget("web"), "packageJson", [
			{
				name: `@${slug}/ui`,
				version: "workspace:*",
				type: "dependencies",
			},
			{ ...deps.next, type: "dependencies" },
			{ ...deps.react, type: "dependencies" },
			{ ...deps.reactDom, type: "dependencies" },
			{ ...deps.typesReact, type: "devDependencies" },
			{ ...deps.typesReactDom, type: "devDependencies" },
		]),
		surfaceScripts(ensuredModuleTarget("web"), "packageJson", {
			dev: "next dev",
			build: "next build",
			start: "next start",
		}),
		surfaceJson(ensuredModuleTarget("web"), "packageJson", {
			name: `@${slug}/web`,
			version: "0.1.0",
			private: true,
			type: "module",
		}),
	];
}

export default nextjsBaseTemplate;
