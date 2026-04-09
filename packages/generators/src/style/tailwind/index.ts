import { defineAddon, dependencies, filePath, textFile } from "@ryuujs/core";
import type { ForgeConfig } from "../../config";
import { deps } from "../../deps";
import { interpolate, readTemplate } from "../../template";

const tailwind = defineAddon<ForgeConfig, "tailwind", "nextjs">({
	id: "tailwind",
	name: "Tailwind CSS",
	version: "0.1.0",
	category: "style",
	exclusive: true,
	dependencies: [{ id: "ui", type: "addon" }],
	targetMode: "single",
	compatibility: {
		app: {
			frameworks: ["nextjs"],
			requiredSlots: ["layout"],
		},
	},
	when: (config) => config.style === "tailwind",
	contribute: ({ config }) => {
		const slug = config.slug ?? "my-app";
		const vars = { SLUG: slug, PROJECT_NAME: config.name ?? slug };

		return [
			textFile(
				filePath("apps/web/app/layout.tsx"),
				interpolate(readTemplate("style/tailwind/layout.tsx"), vars),
			),
			textFile(
				filePath("packages/ui/postcss.config.mjs"),
				readTemplate("style/tailwind/postcss.config.mjs"),
			),
			textFile(
				filePath("packages/ui/src/styles/theme.css"),
				readTemplate("style/tailwind/theme.css"),
			),
			textFile(
				filePath("packages/ui/src/lib/utils.ts"),
				readTemplate("style/tailwind/utils.ts"),
			),
			textFile(
				filePath("packages/ui/src/styles/globals.css"),
				[
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
			),
			dependencies(filePath("packages/ui/package.json"), [
				{ ...deps.tailwindcss, type: "devDependencies" },
				{ ...deps.tailwindPostcss, type: "devDependencies" },
				{ ...deps.postcss, type: "devDependencies" },
				{ ...deps.tailwindMerge, type: "dependencies" },
			]),
			dependencies(filePath("apps/web/package.json"), [
				{ ...deps.tailwindcss, type: "devDependencies" },
				{ ...deps.postcss, type: "devDependencies" },
			]),
		];
	},
});

export default tailwind;
