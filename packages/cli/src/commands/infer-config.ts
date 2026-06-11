import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import { type DiscoveredModule, packageManagers, runtimes } from "@ryuujs/core";
import {
	detectDatabase,
	detectDatabaseProvider,
	type ForgeConfig,
	type OptionalAddon,
} from "@ryuujs/generators";

async function readJsonFile<T>(path: string): Promise<T | undefined> {
	try {
		return JSON.parse(await readFile(path, "utf-8")) as T;
	} catch {
		return undefined;
	}
}

async function readTextFile(path: string): Promise<string | undefined> {
	try {
		return await readFile(path, "utf-8");
	} catch {
		return undefined;
	}
}

export async function inferConfigSnapshot(
	projectRoot: string,
	modules: ReadonlyArray<DiscoveredModule>,
): Promise<ForgeConfig> {
	const packageJson =
		(await readJsonFile<{
			engines?: Record<string, string>;
			name?: string;
			packageManager?: string;
		}>(join(projectRoot, "package.json"))) ?? {};

	const packageName = packageJson.name;
	const slug = packageName ? packageName.replace(/^@[^/]+\//, "") : "my-app";

	const runtime = packageJson.engines?.node
		? runtimes.node.displayName
		: packageJson.engines?.bun
			? runtimes.bun.displayName
			: packageJson.engines?.deno
				? runtimes.deno.displayName
				: runtimes.node.displayName;

	const packageManagerPrefix = packageJson.packageManager?.split("@")[0];
	const packageManager =
		packageManagers[packageManagerPrefix as keyof typeof packageManagers]
			?.displayName || packageManagers.pnpm.displayName;

	const webModule = modules.find((module) => module.type === "app");
	const uiModule = modules.find(
		(module) => module.type === "package" && module.template.id === "ui",
	);
	const dbModule = modules.find(
		(module) => module.type === "package" && module.template.id === "db",
	);

	const web =
		webModule?.type === "app"
			? (webModule.framework as ForgeConfig["web"])
			: undefined;

	const style =
		uiModule?.type === "package" &&
		(uiModule.capabilities ?? []).includes("tailwind")
			? "tailwind"
			: undefined;

	const hasPath = async (path: string) => {
		try {
			await access(join(projectRoot, path));
			return true;
		} catch {
			return false;
		}
	};

	const detectFromMarkers = async <const T extends string>(
		module: DiscoveredModule | undefined,
		markers: ReadonlyArray<readonly [T, string]>,
	): Promise<T | undefined> => {
		if (!module) return undefined;

		for (const [value, marker] of markers)
			if (await hasPath(join(module.root, marker))) return value;

		return undefined;
	};

	const rpc = await detectFromMarkers(webModule, [
		["trpc", "src/trpc/index.ts"],
	]);

	const orm = await detectFromMarkers(dbModule, [
		["drizzle", "drizzle.config.ts"],
		["prisma", "prisma.config.ts"],
	]);

	const authentication = await detectFromMarkers(webModule, [
		["better-auth", webModule?.slots.auth ?? "src/lib/auth.ts"],
	]);

	const linter = (await hasPath("biome.json")) ? "biome" : undefined;

	const [dbPackageJson, dbClientSource, rootEnv] =
		orm !== undefined && dbModule
			? await Promise.all([
					readJsonFile<{ dependencies?: Record<string, string> }>(
						join(projectRoot, dbModule.root, "package.json"),
					),
					readTextFile(join(projectRoot, dbModule.root, "src/client.ts")),
					readTextFile(join(projectRoot, ".env")),
				])
			: [undefined, undefined, undefined];

	const envValue = (name: string) =>
		rootEnv
			?.split(/\r?\n/)
			.find((line) => line.startsWith(`${name}=`))
			?.slice(name.length + 1)
			.replace(/^["'`]|["'`]$/g, "");

	const databaseEvidence = {
		dependencies: dbPackageJson?.dependencies ?? {},
		clientSource: dbClientSource,
		databaseUrl: envValue("DATABASE_URL") ?? envValue("TURSO_DATABASE_URL"),
	};

	const database = detectDatabase(databaseEvidence);
	const databaseProvider = detectDatabaseProvider(databaseEvidence);

	const addonFiles: ReadonlyArray<readonly [OptionalAddon, string]> = [
		["commitlint", "commitlint.config.ts"],
		["github-ci", ".github/workflows/ci.yml"],
		["lefthook", "lefthook.yml"],
		["shared", "packages/shared/package.json"],
		["vscode", ".vscode/settings.json"],
	];

	const addons: OptionalAddon[] = [];
	for (const [addon, path] of addonFiles)
		if (await hasPath(path)) addons.push(addon);

	return {
		addons,
		authentication,
		database,
		databaseProvider,
		linter,
		name: slug,
		orm,
		packageManager,
		path: projectRoot,
		rpc,
		runtime,
		slug,
		style,
		web,
	};
}
