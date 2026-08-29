import {
	defineFramework,
	defineTemplate,
	ensureAppModule,
	ensuredModuleTarget,
	type FrameworkDefinition,
	leafTextFile,
	projectTarget,
	surfaceDependencies,
	surfaceJson,
	surfaceLines,
	surfaceScripts,
	type TemplateDefinition,
} from "@ryuujs/core";
import type { ForgeConfig } from "../../config";
import { envFileLine } from "../../data/providers";
import { deps } from "../../deps";
import { appOrigin } from "../../origins";
import { pmRun, resolvePackageManager } from "../../pm";
import type {
	FirstPartyFrameworkMetadata,
	FirstPartyTemplateMetadata,
} from "../../registry/types";
import { interpolate, readTemplate } from "../../template";

export const expoFramework: FrameworkDefinition<"expo"> = defineFramework({
	id: "expo",
	configFile: "app.json",
	clientEnvPrefix: "EXPO_PUBLIC_",
	buildOutputs: [],
	ignoreDirs: [".expo/"],
	name: "Expo",
	sourceRoot: "src",
	slots: ["layout", "page"],
	tsconfigPreset: {
		name: "expo",
		content: {
			$schema: "https://json.schemastore.org/tsconfig",
			display: "Expo",
			compilerOptions: {
				noUncheckedIndexedAccess: true,
				strict: true,
			},
		},
	},
});

export const expoFrameworkMetadata: FirstPartyFrameworkMetadata = {
	category: "mobile",
	description:
		"Forge's first-party Expo framework for managed React Native mobile applications.",
	experimental: false,
	hidden: false,
	id: "expo",
	keywords: ["app", "expo", "framework", "mobile", "react-native"],
	kind: "framework",
	name: "Expo",
	summary: "Managed Expo mobile app host.",
};

const expoBaseTemplate: TemplateDefinition<ForgeConfig, "expo/base", "expo"> =
	defineTemplate({
		id: "expo/base",
		framework: "expo",
		name: "Base",
		version: 1,
		category: "mobile",
		dependencies: [
			{ id: "root", type: "addon" },
			{ id: "typescript", type: "addon" },
		],
		when: (config) => config.mobile === "expo",
		contribute: ({ config }) => buildContributions(config),
	});

export const expoBaseTemplateMetadata: FirstPartyTemplateMetadata = {
	description:
		"A production-ready Expo base template that composes with Forge server addons.",
	experimental: false,
	hidden: false,
	id: "expo/base",
	keywords: ["base", "expo", "mobile", "react-native", "template"],
	kind: "template",
	name: "Base",
	summary: "Base Expo mobile template.",
};

export function expoScheme(slug: string): string {
	const scheme = slug.toLowerCase().replaceAll(/[^a-z0-9+.-]/g, "");
	return /^[a-z]/.test(scheme) ? scheme : `app-${scheme}`;
}

function buildContributions(config: ForgeConfig) {
	const slug = config.slug ?? "my-app";
	const pm = resolvePackageManager(config);
	const origin = appOrigin(config);

	return [
		ensureAppModule("mobile", "apps/mobile", {
			framework: "expo",
			template: { id: "expo/base", version: 1 },
			slots: {
				layout: "src/app/_layout.tsx",
				page: "src/app/index.tsx",
			},
		}),
		surfaceJson(ensuredModuleTarget("mobile"), "packageJson", {
			name: `@${slug}/mobile`,
			version: "0.1.0",
			private: true,
			main: "expo-router/entry",
		}),
		surfaceJson(ensuredModuleTarget("mobile"), "tsconfig", {
			extends: ["expo/tsconfig.base", `@${slug}/tsconfig/expo.json`],
			compilerOptions: { paths: { "@/*": ["./src/*"] } },
			include: ["**/*.ts", "**/*.tsx", ".expo/types/**/*.ts", "expo-env.d.ts"],
			exclude: ["node_modules"],
		}),
		surfaceDependencies(ensuredModuleTarget("mobile"), "packageJson", [
			{ ...deps.expo, type: "dependencies" },
			{ ...deps.expoConstants, type: "dependencies" },
			{ ...deps.expoLinking, type: "dependencies" },
			{ ...deps.expoRouter, type: "dependencies" },
			{ ...deps.reactNativeSafeAreaContext, type: "dependencies" },
			{ ...deps.reactNativeScreens, type: "dependencies" },
			{ ...deps.react, type: "dependencies" },
			{ ...deps.reactNative, type: "dependencies" },
			{ ...deps.t3OssEnvCore, type: "dependencies" },
			{ ...deps.zod, type: "dependencies" },
			{
				name: `@${slug}/tsconfig`,
				version: "workspace:*",
				type: "devDependencies",
			},
			{ ...deps.dotenvCli, type: "devDependencies" },
			{ ...deps.typesReact, type: "devDependencies" },
			{ ...deps.typescript, type: "devDependencies" },
		]),
		surfaceScripts(ensuredModuleTarget("mobile"), "packageJson", {
			android: pmRun(pm, "with-env", "expo run:android"),
			dev: pmRun(pm, "with-env", "expo start"),
			ios: pmRun(pm, "with-env", "expo run:ios"),
			typecheck: "tsc --noEmit",
			"with-env": "dotenv -e ../../.env --",
		}),
		surfaceLines(
			projectTarget(),
			"rootEnv",
			[envFileLine("EXPO_PUBLIC_SERVER_URL", origin)],
			{ section: "Expo" },
		),
		surfaceLines(
			projectTarget(),
			"rootEnvExample",
			[
				"# Physical devices need your machine's LAN IP instead of localhost.",
				envFileLine("EXPO_PUBLIC_SERVER_URL", origin),
			],
			{ section: "Expo" },
		),
		leafTextFile(
			ensuredModuleTarget("mobile"),
			"app.json",
			interpolate(readTemplate("frameworks/expo/app.json"), {
				SCHEME: expoScheme(slug),
				SLUG: slug,
			}),
		),
		leafTextFile(
			ensuredModuleTarget("mobile"),
			"src/app/_layout.tsx",
			readTemplate("frameworks/expo/src/app/_layout.tsx"),
		),
		leafTextFile(
			ensuredModuleTarget("mobile"),
			"src/app/index.tsx",
			readTemplate("frameworks/expo/src/app/index.tsx"),
		),
		leafTextFile(
			ensuredModuleTarget("mobile"),
			"env.ts",
			interpolate(readTemplate("frameworks/expo/env.ts"), {
				SERVER_ORIGIN: origin,
			}),
		),
	];
}

export default expoBaseTemplate;
