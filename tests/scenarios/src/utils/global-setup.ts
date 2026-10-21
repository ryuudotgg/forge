import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TestProject } from "vitest/node";

declare module "vitest" {
	export interface ProvidedContext {
		xdgCacheHome: string;
		portLockDir: string;
	}
}

export default async function globalSetup(project: TestProject) {
	const root = await mkdtemp(join(tmpdir(), "forge-scenarios-xdg-"));

	const portLockDir = await mkdtemp(join(tmpdir(), "forge-scenarios-locks-"));

	project.provide("xdgCacheHome", root);
	project.provide("portLockDir", portLockDir);

	return async () => {
		await rm(root, { force: true, recursive: true });
		await rm(portLockDir, { force: true, recursive: true });
	};
}
