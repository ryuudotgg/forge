import {
	defineAddon,
	ensuredModuleTarget,
	leafTextFile,
	moduleCapabilities,
	surfaceDependencies,
	surfaceJson,
	templateModuleTarget,
} from "@ryuujs/core";
import type { ForgeConfig } from "../../config";
import { deps } from "../../deps";
import type { FirstPartyAddonMetadata } from "../../registry/types";
import { readTemplate } from "../../template";

const nativewind = defineAddon<ForgeConfig, "nativewind", "expo">({
	id: "nativewind",
	name: "NativeWind",
	version: "0.1.0",
	category: "nativeStyle",
	exclusive: true,
	dependencies: [{ id: "expo/base", type: "template" }],
	targetMode: "single",
	compatibility: { app: { frameworks: ["expo"] } },
	when: (config) =>
		config.mobile === "expo" && config.nativeStyleFramework === "nativewind",
	contribute: () => [
		moduleCapabilities(templateModuleTarget("expo/base", 1), ["nativewind"]),
		surfaceDependencies(ensuredModuleTarget("mobile"), "packageJson", [
			{ ...deps.nativewind, type: "dependencies" },
			{ ...deps.reactNativeCss, type: "dependencies" },
			{ ...deps.reactNativeReanimated, type: "dependencies" },
			{ ...deps.reactNativeWorklets, type: "dependencies" },
			{ ...deps.tailwindcss, type: "devDependencies" },
			{ ...deps.tailwindPostcss, type: "devDependencies" },
		]),
		surfaceJson(ensuredModuleTarget("mobile"), "tsconfig", {
			include: ["nativewind-env.d.ts"],
		}),
		leafTextFile(
			ensuredModuleTarget("mobile"),
			"global.css",
			readTemplate("style/nativewind/global.css"),
		),
		leafTextFile(
			ensuredModuleTarget("mobile"),
			"metro.config.js",
			readTemplate("style/nativewind/metro.config.js"),
		),
		leafTextFile(
			ensuredModuleTarget("mobile"),
			"postcss.config.mjs",
			readTemplate("style/nativewind/postcss.config.mjs"),
		),
		leafTextFile(
			ensuredModuleTarget("mobile"),
			"nativewind-env.d.ts",
			readTemplate("style/nativewind/nativewind-env.d.ts"),
		),
	],
});

export const nativewindMetadata = {
	description: "Adds NativeWind v5 styling to the Expo mobile app.",
	experimental: false,
	hidden: false,
	id: "nativewind",
	keywords: ["expo", "nativewind", "react-native", "styles"],
	kind: "addon",
	name: "NativeWind",
	summary: "Add NativeWind styling to the Expo app.",
} as const satisfies FirstPartyAddonMetadata;

export default nativewind;
