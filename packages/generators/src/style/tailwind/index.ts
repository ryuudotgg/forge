import {
	defineAddon,
	moduleCapabilities,
	selectedModuleTarget,
	surfaceDependencies,
	surfaceText,
	templateModuleTarget,
} from "@ryuujs/core";
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
			surfaceText(
				selectedModuleTarget(),
				"layout",
				interpolate(readTemplate("style/tailwind/layout.tsx"), vars),
				{ priority: 1 },
			),
			surfaceText(
				templateModuleTarget("ui", 1),
				"postcssConfig",
				readTemplate("style/tailwind/postcss.config.mjs"),
			),
			surfaceText(
				templateModuleTarget("ui", 1),
				"themeCss",
				readTemplate("style/tailwind/theme.css"),
			),
			surfaceText(
				templateModuleTarget("ui", 1),
				"utils",
				readTemplate("style/tailwind/utils.ts"),
				{ priority: 1 },
			),
			surfaceText(
				templateModuleTarget("ui", 1),
				"globalsCss",
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
				{ priority: 1 },
			),
			moduleCapabilities(templateModuleTarget("ui", 1), ["tailwind"]),
			surfaceDependencies(templateModuleTarget("ui", 1), "packageJson", [
				{ ...deps.tailwindcss, type: "devDependencies" },
				{ ...deps.tailwindPostcss, type: "devDependencies" },
				{ ...deps.postcss, type: "devDependencies" },
				{ ...deps.tailwindMerge, type: "dependencies" },
			]),
			surfaceDependencies(selectedModuleTarget(), "packageJson", [
				{ ...deps.tailwindcss, type: "devDependencies" },
				{ ...deps.postcss, type: "devDependencies" },
			]),
		];
	},
});

export default tailwind;
