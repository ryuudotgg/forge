import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TestProject } from "vitest/node";

declare module "vitest" {
	export interface ProvidedContext {
		xdgCacheHome: string;
	}
}

export default async function globalSetup(project: TestProject) {
	const root = await mkdtemp(join(tmpdir(), "forge-scenarios-xdg-"));

	project.provide("xdgCacheHome", root);

	return async () => {
		await rm(root, { force: true, recursive: true });
	};
}
