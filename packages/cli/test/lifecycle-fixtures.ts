import type { InstallRecord } from "@ryuujs/core";

export const appModule = {
	framework: "nextjs" as const,
	id: "abcde",
	packageName: "@acme/web",
	root: "apps/web",
	slots: { layout: "app/layout.tsx" },
	template: { id: "base", version: 1 },
	type: "app" as const,
};

export const adminModule = {
	...appModule,
	id: "fghij",
	packageName: "@acme/admin",
	root: "apps/admin",
};

export function managedProject(options?: {
	readonly installs?: ReadonlyArray<InstallRecord>;
	readonly modules?: ReadonlyArray<typeof appModule>;
}) {
	return {
		config: { slug: "acme", web: "nextjs" },
		manifest: {
			config: {},
			installs: [...(options?.installs ?? [])],
			modules: {},
		},
		modules: options?.modules ?? [appModule],
		projectRoot: ".",
	};
}
