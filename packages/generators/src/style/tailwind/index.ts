import type { FileOperation } from "@ryuujs/core";
import { defineGenerator, filePath } from "@ryuujs/core";
import { Effect } from "effect";
import type { ForgeConfig } from "../../config";
import { deps } from "../../deps";
import { interpolate, readTemplate } from "../../template";

export default defineGenerator<ForgeConfig>({
	id: "style/tailwind",
	name: "Tailwind CSS",
	version: "0.1.0",
	category: "style",
	exclusive: true,
	dependencies: ["ui"],

	appliesTo: (config) => config.style === "Tailwind CSS",

	generate: (config) => Effect.succeed(buildOperations(config)),
});

function buildOperations(config: ForgeConfig): ReadonlyArray<FileOperation> {
	const slug = config.slug ?? "my-app";

	const vars = { SLUG: slug, PROJECT_NAME: config.name ?? slug };

	return [
		{
			_tag: "CreateFile",
			path: filePath("apps/web/app/layout.tsx"),
			content: interpolate(readTemplate("style/tailwind/layout.tsx"), vars),
		},
		{
			_tag: "CreateFile",
			path: filePath("packages/ui/postcss.config.mjs"),
			content: readTemplate("style/tailwind/postcss.config.mjs"),
		},
		{
			_tag: "CreateFile",
			path: filePath("packages/ui/src/styles/theme.css"),
			content: readTemplate("style/tailwind/theme.css"),
		},
		{
			_tag: "CreateFile",
			path: filePath("packages/ui/src/lib/utils.ts"),
			content: readTemplate("style/tailwind/utils.ts"),
		},
		{
			_tag: "CreateFile",
			path: filePath("packages/ui/src/styles/globals.css"),
			content: [
				'@import "tailwindcss";',
				'@import "./theme.css";',
				"",
				"@custom-variant dark (&:is(.dark *));",
				'@source "../../../../apps/**/*.{ts,tsx}";',
				'@source "../**/*.{ts,tsx}";',
				"",
				"@layer base {",
				"\t* {",
				"\t\t@apply border-border outline-ring/50;",
				"\t}",
				"",
				"\tbody {",
				"\t\t@apply bg-background text-foreground;",
				"\t}",
				"}",
				"",
			].join("\n"),
		},
		{
			_tag: "AddDependencies",
			path: filePath("packages/ui/package.json"),
			dependencies: [
				{ ...deps.tailwindcss, type: "devDependencies" },
				{ ...deps.tailwindPostcss, type: "devDependencies" },
				{ ...deps.postcss, type: "devDependencies" },
				{ ...deps.tailwindMerge, type: "dependencies" },
			],
		},
		{
			_tag: "AddDependencies",
			path: filePath("apps/web/package.json"),
			dependencies: [
				{ ...deps.tailwindcss, type: "devDependencies" },
				{ ...deps.postcss, type: "devDependencies" },
			],
		},
	];
}
