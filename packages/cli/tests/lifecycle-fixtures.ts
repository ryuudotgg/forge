import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
	type DiscoveredModule,
	defineAddon,
	type InstallRecord,
	type Manifest,
} from "@ryuujs/core";
import type { ForgeConfig } from "@ryuujs/generators";
import type { ManagedProject } from "../src/commands/lifecycle";

export async function withTempDir<T>(
	name: string,
	run: (directory: string) => Promise<T>,
) {
	const directory = await mkdtemp(join(tmpdir(), `forge-${name}-`));

	try {
		return await run(directory);
	} finally {
		await rm(directory, { force: true, recursive: true });
	}
}

export async function writeText(path: string, content: string) {
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, content, "utf-8");
}

export async function writeJson(path: string, value: unknown) {
	await writeText(path, `${JSON.stringify(value, null, "\t")}\n`);
}

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
	slots: {
		auth: "app/api/auth/[...all]/route.ts",
		layout: "app/layout.tsx",
		trpc: "app/api/trpc/[trpc]/route.ts",
	},
	template: { id: "nextjs/base", version: 1 },
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
	template: { id: "react-router/base", version: 1 },
	type: "app",
};

export const packageModule: DiscoveredModule = {
	capabilities: ["react"],
	id: "pqrst",
	packageName: "@acme/ui",
	packageType: "library",
	root: "packages/ui",
	slots: { utils: "src/lib/utils.ts" },
	template: { id: "ui", version: 1 },
	type: "package",
};

export function managedProject(options?: {
	readonly config?: ForgeConfig;
	readonly installs?: ReadonlyArray<InstallRecord>;
	readonly modules?: ReadonlyArray<DiscoveredModule>;
	readonly registries?: ReadonlyArray<string>;
	readonly registryDescriptors?: Manifest["registryDescriptors"];
}): ManagedProject {
	return {
		config: options?.config ?? { slug: "acme", web: "nextjs" },
		manifest: {
			schemaVersion: 1,
			config: {},
			installs: [...(options?.installs ?? [])],
			modules: {},
			...(options?.registries === undefined
				? {}
				: { registries: options.registries }),
			...(options?.registryDescriptors === undefined
				? {}
				: { registryDescriptors: options.registryDescriptors }),
		},
		modules: options?.modules ?? [appModule],
		projectRoot: ".",
	};
}
