import {
	defineFramework,
	defineTemplate,
	dependencies,
	type FrameworkDefinition,
	filePath,
	jsonFile,
	scripts,
	type TemplateDefinition,
} from "@ryuujs/core";
import type { ForgeConfig } from "../../config";
import { deps } from "../../deps";
import { interpolate, templateFiles } from "../../template";

export const nextjsFramework: FrameworkDefinition<"nextjs"> = defineFramework({
	id: "nextjs",
	name: "Next.js",
	slots: ["layout", "page", "api", "trpc", "db", "auth", "authClient"],
});

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

function buildContributions(config: ForgeConfig) {
	const slug = config.slug ?? "my-app";
	const projectName = config.name ?? slug;
	const vars = { PROJECT_NAME: projectName, SLUG: slug };

	const templates = templateFiles("frameworks/nextjs", "apps/web").map(
		(entry) =>
			entry._tag === "TextFileContribution"
				? {
						...entry,
						content: interpolate(entry.content, vars),
					}
				: entry,
	);

	return [
		...templates,
		jsonFile(filePath("apps/web/tsconfig.json"), {
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
		dependencies(filePath("apps/web/package.json"), [
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
		scripts(filePath("apps/web/package.json"), {
			dev: "next dev",
			build: "next build",
			start: "next start",
		}),
		jsonFile(filePath("apps/web/package.json"), {
			name: `@${slug}/web`,
			version: "0.1.0",
			private: true,
			type: "module",
		}),
	];
}

export default nextjsBaseTemplate;
