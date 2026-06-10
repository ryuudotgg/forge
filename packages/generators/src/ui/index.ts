import {
	defineAddon,
	ensuredModuleTarget,
	ensurePackageModule,
	leafTextFile,
	surfaceDependencies,
	surfaceJson,
} from "@ryuujs/core";
import type { ForgeConfig } from "../config";
import { deps } from "../deps";
import { pmDlx, resolvePackageManager } from "../pm";
import type { FirstPartyAddonMetadata } from "../registry/types";
import { interpolate, readTemplate } from "../template";

const ui = defineAddon<ForgeConfig, "ui", "nextjs">({
	id: "ui",
	name: "UI Package",
	version: "0.1.0",
	category: "ui",
	exclusive: true,
	dependencies: [{ id: "typescript", type: "addon" }],
	targetMode: "single",
	when: (config) => !!config.web,
	contribute: ({ config }) => {
		const slug = config.slug ?? "my-app";

		const pm = resolvePackageManager(config);
		const useTailwind = config.style === "tailwind";

		const vars = { SLUG: slug };
		const render = (path: string) =>
			interpolate(readTemplate(`ui/${path}`), vars);

		const uiComponentsJson = {
			$schema: "https://ui.shadcn.com/schema.json",
			style: "default",
			rsc: true,
			tsx: true,
			tailwind: {
				config: "",
				css: "src/styles/globals.css",
				baseColor: "neutral",
				cssVariables: true,
			},
			iconLibrary: "lucide",
			aliases: {
				components: `@${slug}/ui/components`,
				utils: `@${slug}/ui/lib/utils`,
				hooks: `@${slug}/ui/hooks`,
				lib: `@${slug}/ui/lib`,
				ui: `@${slug}/ui/components`,
			},
		};

		const appComponentsJson = {
			$schema: "https://ui.shadcn.com/schema.json",
			style: "default",
			rsc: true,
			tsx: true,
			tailwind: {
				config: "",
				css: "../../packages/ui/src/styles/globals.css",
				baseColor: "neutral",
				cssVariables: true,
			},
			iconLibrary: "lucide",
			aliases: {
				components: "@/components",
				hooks: "@/hooks",
				lib: "@/lib",
				utils: `@${slug}/ui/lib/utils`,
				ui: `@${slug}/ui/components`,
			},
		};

		const uiPackageJson = {
			name: `@${slug}/ui`,
			private: true,
			type: "module",
			exports: {
				"./globals.css": "./src/styles/globals.css",
				"./postcss.config": "./postcss.config.mjs",
				"./hooks/*": "./src/hooks/*.ts",
				"./lib/*": "./src/lib/*.ts",
				"./*": "./src/components/*.tsx",
			},
			scripts: {
				typecheck: "tsgo --noEmit",
				"ui-add": pmDlx(pm, "shadcn@latest add"),
			},
		};

		const uiTsconfig = {
			extends: `@${slug}/tsconfig/react-library.json`,
			compilerOptions: { paths: { [`@${slug}/ui/*`]: ["./src/*"] } },
			include: ["."],
			exclude: ["node_modules", "dist"],
		};

		const uiDeps: Array<{
			name: string;
			version: string;
			catalog?: string;
			type: "dependencies" | "devDependencies" | "peerDependencies";
		}> = [
			{ ...deps.clsx, type: "dependencies" },
			{ ...deps.tailwindMerge, type: "dependencies" },
			{ ...deps.classVarianceAuthority, type: "dependencies" },
			{ ...deps.react, type: "dependencies" },
			{ ...deps.reactDom, type: "dependencies" },
			{ ...deps.nextThemes, type: "dependencies" },
			{ ...deps.sonner, type: "dependencies" },
			{ ...deps.inputOtp, type: "dependencies" },
			{ ...deps.zod, type: "dependencies" },
			{
				name: `@${slug}/tsconfig`,
				version: "workspace:*",
				type: "devDependencies",
			},
			{ ...deps.typesNode, type: "devDependencies" },
			{ ...deps.typesReact, type: "devDependencies" },
			{ ...deps.typesReactDom, type: "devDependencies" },
			{ ...deps.typescriptNativePreview, type: "devDependencies" },
			{ ...deps.typescript, type: "devDependencies" },
		];

		if (useTailwind) {
			uiDeps.push({ ...deps.tailwindcss, type: "devDependencies" });
			uiDeps.push({ ...deps.tailwindPostcss, type: "devDependencies" });
			uiDeps.push({ ...deps.twAnimateCss, type: "dependencies" });
			uiDeps.push({ ...deps.shadcn, type: "devDependencies" });
		}

		return [
			ensurePackageModule("ui", "packages/ui", {
				packageType: "library",
				template: { id: "ui", version: 1 },
				capabilities: ["react", "ui", useTailwind ? "tailwind" : "css"],
				slots: {
					globalsCss: "src/styles/globals.css",
					utils: "src/lib/utils.ts",
					postcssConfig: "postcss.config.mjs",
				},
			}),
			surfaceJson(ensuredModuleTarget("ui"), "packageJson", uiPackageJson),
			surfaceJson(ensuredModuleTarget("ui"), "tsconfig", uiTsconfig),
			surfaceDependencies(ensuredModuleTarget("ui"), "packageJson", uiDeps),

			leafTextFile(
				ensuredModuleTarget("ui"),
				"src/lib/utils.ts",
				render("packages/ui/src/lib/utils.ts"),
			),
			leafTextFile(
				ensuredModuleTarget("ui"),
				"src/styles/globals.css",
				render("packages/ui/src/styles/globals.css"),
			),
			leafTextFile(
				ensuredModuleTarget("ui"),
				"postcss.config.mjs",
				render("packages/ui/postcss.config.mjs"),
			),
			leafTextFile(
				ensuredModuleTarget("ui"),
				"src/components/button.tsx",
				render("packages/ui/src/components/button.tsx"),
			),
			leafTextFile(
				ensuredModuleTarget("ui"),
				"components.json",
				`${JSON.stringify(uiComponentsJson, null, 2)}\n`,
			),

			leafTextFile(
				ensuredModuleTarget("web"),
				"components.json",
				`${JSON.stringify(appComponentsJson, null, 2)}\n`,
			),
			leafTextFile(
				ensuredModuleTarget("web"),
				"postcss.config.mjs",
				`export { default } from "@${slug}/ui/postcss.config";\n`,
			),
		];
	},
});

export const uiMetadata = {
	description:
		"Creates a reusable shared UI package with managed styling and utility surfaces.",
	experimental: false,
	hidden: false,
	id: "ui",
	keywords: ["components", "design system", "react", "ui"],
	kind: "addon",
	name: "UI Package",
	summary: "Create a shared UI package.",
} as const satisfies FirstPartyAddonMetadata;

export default ui;
