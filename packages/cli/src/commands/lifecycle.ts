import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { log } from "@clack/prompts";
import { NodeContext } from "@effect/platform-node";
import {
	Apply,
	ConfigStore,
	CoreLive,
	type DiscoveredModule,
	type InstallRecord,
	type Manifest,
	Planner,
	packageManagers,
	runtimes,
	State,
} from "@ryuujs/core";
import {
	detectDatabaseProvider,
	type ForgeConfig,
	loadDefinitionRegistry,
	type OptionalAddon,
} from "@ryuujs/generators";
import { Effect, Layer } from "effect";

const coreLayer = CoreLive.pipe(Layer.provideMerge(NodeContext.layer));

function lifecycleUnavailableMessage(command: string) {
	return `We couldn't run "${command}" here because this project hasn't been bootstrapped with the current Forge metadata yet.`;
}

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

async function inferConfigSnapshot(
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
			await readFile(join(projectRoot, path), "utf-8");
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

	const databaseProvider = detectDatabaseProvider({
		dependencies: dbPackageJson?.dependencies ?? {},
		clientSource: dbClientSource,
		databaseUrl: rootEnv
			?.match(/^DATABASE_URL=(.*)$/m)?.[1]
			?.replace(/^"|"$/g, ""),
	});

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

export interface ManagedProject {
	readonly config: ForgeConfig;
	readonly manifest: Manifest;
	readonly modules: ReadonlyArray<DiscoveredModule>;
	readonly projectRoot: string;
}

export async function loadManagedProject(
	projectRoot: string,
	command: string,
): Promise<ManagedProject> {
	const isManagedProject = await Effect.runPromise(
		State.isManagedProject(projectRoot).pipe(Effect.provide(coreLayer)),
	);

	if (!isManagedProject) {
		log.error(lifecycleUnavailableMessage(command));
		process.exit(1);
	}

	const [manifest, modules] = await Promise.all([
		Effect.runPromise(
			State.readManifest(projectRoot).pipe(Effect.provide(coreLayer)),
		),
		Effect.runPromise(
			ConfigStore.discover(projectRoot).pipe(Effect.provide(coreLayer)),
		),
	]);

	const config =
		Object.keys(manifest.config).length > 0
			? (manifest.config as ForgeConfig)
			: await inferConfigSnapshot(projectRoot, modules);

	const needsNormalization =
		manifest.installs.length === 0 ||
		Object.values(manifest.modules).some(
			(record) =>
				record.definitionIds.length === 0 || record.root === undefined,
		);

	const normalizedManifest = needsNormalization
		? (
				await Effect.runPromise(
					Effect.flatMap(Planner, (planner) =>
						Effect.sync(() => loadDefinitionRegistry()).pipe(
							Effect.flatMap((loadedRegistry) =>
								planner.planInstalled(
									projectRoot,
									config,
									manifest.installs,
									loadedRegistry.registry,
								),
							),
						),
					).pipe(Effect.provide(coreLayer)),
				)
			).manifest
		: manifest;

	return {
		config,
		manifest: normalizedManifest,
		modules,
		projectRoot,
	};
}

export async function applyInstalledPlan(
	projectRoot: string,
	config: ForgeConfig,
	installs: ReadonlyArray<InstallRecord>,
) {
	const loadedRegistry = await loadDefinitionRegistry();
	const plan = await Effect.runPromise(
		Effect.flatMap(Planner, (planner) =>
			planner.planInstalled(
				projectRoot,
				config,
				installs,
				loadedRegistry.registry,
			),
		).pipe(Effect.provide(coreLayer)),
	);

	await Effect.runPromise(
		Apply.applyPlan(projectRoot, {
			lockfile: plan.lockfile,
			manifest: plan.manifest,
			removals: plan.removals,
			writes: plan.writes.map((write) => ({
				artifactId: write.artifactId,
				content: write.content,
				path: write.path,
			})),
		}).pipe(Effect.provide(coreLayer)),
	);
}
