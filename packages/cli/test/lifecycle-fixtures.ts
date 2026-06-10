import {
	type DiscoveredModule,
	defineAddon,
	type InstallRecord,
} from "@ryuujs/core";
import type { ForgeConfig } from "@ryuujs/generators";

export const singleTargetAddon = defineAddon<ForgeConfig, "mock-single">({
	id: "mock-single",
	name: "Mock Single",
	version: "0.1.0",
	category: "ui",
	exclusive: false,
	targetMode: "single",
	compatibility: { app: { frameworks: ["nextjs"] } },
	when: () => false,
	contribute: () => [],
});

export const multiTargetAddon = defineAddon<ForgeConfig, "mock-multi">({
	id: "mock-multi",
	name: "Mock Multi",
	version: "0.1.0",
	category: "ui",
	exclusive: false,
	targetMode: "multiple",
	compatibility: { app: { frameworks: ["nextjs"] } },
	when: () => false,
	contribute: () => [],
});

export const appModule: DiscoveredModule = {
	framework: "nextjs",
	id: "abcde",
	packageName: "@acme/web",
	root: "apps/web",
	slots: { layout: "app/layout.tsx" },
	template: { id: "base", version: 1 },
	type: "app",
};

export const adminModule: DiscoveredModule = {
	...appModule,
	id: "fghij",
	packageName: "@acme/admin",
	root: "apps/admin",
};

export const reactRouterModule: DiscoveredModule = {
	framework: "react-router",
	id: "klmno",
	packageName: "@acme/legacy",
	root: "apps/legacy",
	slots: { layout: "app/layout.tsx" },
	template: { id: "base", version: 1 },
	type: "app",
};

export function managedProject(options?: {
	readonly config?: ForgeConfig;
	readonly installs?: ReadonlyArray<InstallRecord>;
	readonly modules?: ReadonlyArray<DiscoveredModule>;
}) {
	return {
		config: options?.config ?? { slug: "acme", web: "nextjs" },
		manifest: {
			config: {},
			installs: [...(options?.installs ?? [])],
			modules: {},
		},
		modules: options?.modules ?? [appModule],
		projectRoot: ".",
	};
}
