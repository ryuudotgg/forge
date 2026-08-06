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
import { renderUiTemplate } from "./shared";

const ui = defineAddon<ForgeConfig, "ui">({
	id: "ui",
	name: "UI Package",
	version: "0.1.0",
	category: "ui",
	exclusive: true,
	dependencies: [{ id: "typescript", type: "addon" }],
	targetMode: "multiple",
	when: (config) => !!config.web,
	contribute: ({ config }) => {
		const slug = config.slug ?? "my-app";
		const pm = resolvePackageManager(config);
		const useTailwind = config.style === "tailwind";

		const uiLibrary = config.uiLibrary ?? "base-ui";
		const useBaseUi = uiLibrary === "base-ui";

		const uiPackageJson = {
			name: `@${slug}/ui`,
			private: true,
			type: "module",
			exports: {
				"./globals.css": "./src/styles/globals.css",
			},
			scripts: {
				typecheck: "tsc --noEmit",
				"ui-add": pmDlx(pm, "shadcn@latest add"),
			},
		};

		const uiPackageExports = {
			exports: {
				"./hooks/*": "./src/hooks/*.ts",
				"./lib/*": "./src/lib/*.ts",
				"./*": "./src/components/*.tsx",
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
			{ ...deps.typescript, type: "devDependencies" },
		];

		if (useBaseUi) {
			uiDeps.push({ ...deps.baseUiReact, type: "dependencies" });
		}

		if (useTailwind) {
			uiDeps.push({ ...deps.tailwindcss, type: "devDependencies" });
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
				},
			}),
			surfaceJson(ensuredModuleTarget("ui"), "packageJson", uiPackageJson),
			surfaceJson(ensuredModuleTarget("ui"), "packageJson", uiPackageExports, {
				priority: 2,
			}),
			surfaceJson(ensuredModuleTarget("ui"), "tsconfig", uiTsconfig),
			surfaceDependencies(ensuredModuleTarget("ui"), "packageJson", uiDeps),

			leafTextFile(
				ensuredModuleTarget("ui"),
				"src/lib/utils.ts",
				renderUiTemplate(config, "packages/ui/src/lib/utils.ts"),
			),
			leafTextFile(
				ensuredModuleTarget("ui"),
				"src/styles/globals.css",
				renderUiTemplate(config, "packages/ui/src/styles/globals.css"),
			),
			leafTextFile(
				ensuredModuleTarget("ui"),
				"src/components/button.tsx",
				renderUiTemplate(config, "packages/ui/src/components/button.tsx"),
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
