import type { FileOperation } from "@ryuujs/core";
import { defineGenerator, filePath } from "@ryuujs/core";
import { Effect } from "effect";
import type { ForgeConfig } from "../../config";
import { deps } from "../../deps";
import { interpolate, templateFiles } from "../../template";

export default defineGenerator<ForgeConfig>({
	id: "frameworks/nextjs",
	name: "Next.js",
	version: "0.1.0",
	category: "web",
	exclusive: true,
	dependencies: ["tooling/typescript", "ui"],

	appliesTo: (config) => config.web === "Next.js",

	generate: (config) => Effect.succeed(buildOperations(config)),
});

function buildOperations(config: ForgeConfig): ReadonlyArray<FileOperation> {
	const slug = config.slug ?? "my-app";
	const projectName = config.name ?? slug;
	const vars = { PROJECT_NAME: projectName, SLUG: slug };

	const templates = templateFiles("frameworks/nextjs", "apps/web");

	const interpolated = templates.map((op) => ({
		...op,
		content: interpolate(op.content, vars),
	}));

	return [
		...interpolated,
		{
			_tag: "CreateJson",
			path: filePath("apps/web/tsconfig.json"),
			value: {
				extends: "../../tsconfig.json",
				compilerOptions: {
					jsx: "preserve",
					jsxImportSource: "react",
					paths: { "~/*": ["./src/*"] },
					plugins: [{ name: "next" }],
				},
				include: [
					"next-env.d.ts",
					"**/*.ts",
					"**/*.tsx",
					".next/types/**/*.ts",
				],
				exclude: ["node_modules"],
			},
		},
		{
			_tag: "AddDependencies",
			path: filePath("apps/web/package.json"),
			dependencies: [
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
			],
		},
		{
			_tag: "AddScripts",
			path: filePath("apps/web/package.json"),
			scripts: {
				dev: "next dev",
				build: "next build",
				start: "next start",
			},
		},
		{
			_tag: "CreateJson",
			path: filePath("apps/web/package.json"),
			value: {
				name: `@${slug}/web`,
				version: "0.1.0",
				private: true,
				type: "module",
			},
		},
	];
}
