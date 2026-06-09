import {
	defineAddon,
	moduleCapabilities,
	templateModuleTarget,
} from "@ryuujs/core";
import type { ForgeConfig } from "../../config";
import type { FirstPartyAddonMetadata } from "../../registry/types";

const tailwind = defineAddon<ForgeConfig, "tailwind", "nextjs">({
	id: "tailwind",
	name: "Tailwind CSS",
	version: "0.1.0",
	category: "style",
	exclusive: true,
	dependencies: [{ id: "ui", type: "addon" }],
	targetMode: "single",
	when: (config) => config.style === "tailwind",
	contribute: () => [
		moduleCapabilities(templateModuleTarget("ui", 1), ["tailwind"]),
	],
});

export const tailwindMetadata = {
	description:
		"Adds Tailwind CSS to compatible app and shared UI surfaces managed by Forge.",
	experimental: false,
	hidden: false,
	id: "tailwind",
	keywords: ["css", "styles", "tailwind"],
	kind: "addon",
	name: "Tailwind CSS",
	summary: "Add Tailwind CSS support.",
} as const satisfies FirstPartyAddonMetadata;

export default tailwind;
