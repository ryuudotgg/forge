import {
	defineAddon,
	type FrameworkDefinition,
	GeneratorError,
	leafTextFile,
	packageManagerCommand,
	projectTarget,
	runtimeCommand,
	surfaceDependencies,
	surfaceJson,
	surfaceScripts,
} from "@ryuujs/core";
import { Effect } from "effect";
import type { ForgeConfig } from "../config";
import { resolveDatabaseProvider } from "../data/providers";
import { deps } from "../deps";
import type { FirstPartyAddonMetadata } from "../registry/types";

const root = defineAddon<ForgeConfig, "root">({
	id: "root",
	name: "Root Workspace",
	version: "0.1.0",
	category: "workspace",
	exclusive: true,
	targetMode: "single",
	when: () => true,
	contribute: ({ commandVersions, config, frameworks }) =>
		Effect.gen(function* () {
			const runtime = config.runtime ?? "Node.js";
			const runtimeCommandName = runtimeCommand(runtime);

			const packageManager = config.packageManager ?? "pnpm";
			const packageManagerCommandName = packageManagerCommand(packageManager);

			const runtimeVersion = commandVersions[runtimeCommandName];
			if (runtimeVersion === undefined)
				return yield* new GeneratorError({
					generatorId: "root",
					reason: "command-version-missing",
					command: runtimeCommandName,
				});

			const nodeVersion = commandVersions.node;
			if (nodeVersion === undefined)
				return yield* new GeneratorError({
					generatorId: "root",
					reason: "command-version-missing",
					command: "node",
				});

			const packageManagerVersion = commandVersions[packageManagerCommandName];
			if (packageManagerVersion === undefined)
				return yield* new GeneratorError({
					generatorId: "root",
					reason: "command-version-missing",
					command: packageManagerCommandName,
				});

			return buildContributions(
				config,
				runtimeVersion,
				packageManagerVersion,
				nodeVersion,
				frameworks,
			);
		}),
});

export const rootMetadata = {
	description:
		"Internal project bootstrap metadata and root workspace shaping for managed Forge projects.",
	experimental: false,
	hidden: true,
	id: "root",
	keywords: ["internal", "root", "workspace"],
	kind: "addon",
	name: "Root Workspace",
	summary: "Internal root project bootstrap.",
} as const satisfies FirstPartyAddonMetadata;

function buildContributions(
	config: ForgeConfig,
	runtimeVersion: string,
	packageManagerVersion: string,
	nodeVersion: string,
	frameworks: ReadonlyArray<FrameworkDefinition>,
) {
	const slug = config.slug ?? "my-app";

	const runtime = config.runtime ?? "Node.js";
	const runtimeCommandName = runtimeCommand(runtime);

	const packageManager = config.packageManager ?? "pnpm";
	const packageManagerCommandName = packageManagerCommand(packageManager);

	const packageJson: Record<string, unknown> = {
		name: slug,
		private: true,
		packageManager: `${packageManagerCommandName}@${packageManagerVersion}`,
		engines: {
			[runtimeCommandName]: runtimeVersion,
			[packageManagerCommandName]: `^${packageManagerVersion}`,
		},
	};

	if (packageManagerCommandName !== "pnpm")
		packageJson.workspaces = ["apps/*", "packages/*", "tooling/*"];

	const tsconfigDevDep = {
		name: `@${slug}/tsconfig`,
		version: "workspace:*",
		type: "devDependencies" as const,
	};

	const scripts: Record<string, string> = {
		build: "turbo run build",
		check: "biome check .",
		"check:fix": "biome check --write .",
		"check:ws": "sherif",
		dev: "turbo run dev",
		typecheck: "turbo run typecheck",
	};

	const dbEnv =
		config.orm !== undefined
			? resolveDatabaseProvider(config).envVars.map(({ name }) => name)
			: [];

	const buildTask: Record<string, unknown> = {
		dependsOn: ["^build"],
		inputs: ["$TURBO_DEFAULT$", ".env*"],
	};

	if (dbEnv.length > 0) buildTask.env = dbEnv;

	const framework = frameworks.find((entry) => entry.id === config.web);
	if (config.web !== undefined && !framework)
		throw new Error(`Framework Definition Missing: ${config.web}`);

	if (framework) buildTask.outputs = framework.buildOutputs;

	return [
		surfaceJson(projectTarget(), "rootPackageJson", packageJson),
		surfaceDependencies(projectTarget(), "rootPackageJson", [
			tsconfigDevDep,
			{ ...deps.sherif, type: "devDependencies" },
			{ ...deps.turbo, type: "devDependencies" },
			{ ...deps.typescript, type: "devDependencies" },
		]),
		surfaceScripts(projectTarget(), "rootPackageJson", scripts),
		surfaceJson(projectTarget(), "workspaceConfig", {
			$schema: "https://turborepo.com/schema.json",
			ui: "tui",
			tasks: {
				build: buildTask,
				typecheck: { dependsOn: ["^typecheck"] },
				dev: { cache: false, persistent: true },
			},
		}),
		leafTextFile(projectTarget(), ".nvmrc", `v${nodeVersion}\n`),
	];
}

export default root;
