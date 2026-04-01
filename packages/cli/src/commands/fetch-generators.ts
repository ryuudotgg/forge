import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { Generator } from "@ryuujs/core";
import type { ForgeConfig } from "@ryuujs/generators";

const CACHE_DIR = join(homedir(), ".cache", "forge", "generators");

interface NpmVersionMeta {
	dist?: { tarball?: string };
}

export async function fetchBaseGenerators(
	version: string,
): Promise<ReadonlyArray<Generator<ForgeConfig>> | null> {
	try {
		const versionDir = join(CACHE_DIR, version);
		const entryPoint = join(versionDir, "dist", "index.mjs");

		if (existsSync(entryPoint)) {
			const mod: { generators?: ReadonlyArray<Generator<ForgeConfig>> } =
				await import(pathToFileURL(entryPoint).href);

			return mod.generators ?? null;
		}

		const metaRes = await fetch(
			`https://registry.npmjs.org/@ryuujs/generators/${encodeURIComponent(version)}`,
		);

		if (!metaRes.ok) return null;

		const meta: NpmVersionMeta = (await metaRes.json()) as NpmVersionMeta;

		const tarballUrl = meta.dist?.tarball;
		if (!tarballUrl) return null;

		const tarRes = await fetch(tarballUrl);
		if (!tarRes.ok) return null;

		const buffer = Buffer.from(await tarRes.arrayBuffer());
		mkdirSync(versionDir, { recursive: true });

		const tarballPath = join(versionDir, "package.tgz");
		writeFileSync(tarballPath, buffer);

		execFileSync("tar", ["-xzf", "package.tgz", "--strip-components=1"], {
			cwd: versionDir,
		});

		if (!existsSync(entryPoint)) return null;

		const mod: { generators?: ReadonlyArray<Generator<ForgeConfig>> } =
			await import(pathToFileURL(entryPoint).href);

		return mod.generators ?? null;
	} catch {
		return null;
	}
}
