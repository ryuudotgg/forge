import {
	CommandProbe,
	defineAddon,
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
	contribute: ({ config }) =>
		Effect.gen(function* () {
			const runtime = config.runtime ?? "Node.js";
			const runtimeCommandName = runtimeCommand(runtime);

			const packageManager = config.packageManager ?? "pnpm";
			const packageManagerCommandName = packageManagerCommand(packageManager);

			const runtimeVersion = yield* CommandProbe.readVersion(
				runtimeCommandName,
			).pipe(
				Effect.mapError(
					(error) =>
						new GeneratorError({
							generatorId: "root",
							message: `Command Version Probe Failed: ${runtimeCommandName} ${error.detail}`,
						}),
				),
			);

			const packageManagerVersion = yield* CommandProbe.readVersion(
				packageManagerCommandName,
			).pipe(
				Effect.mapError(
					(error) =>
						new GeneratorError({
							generatorId: "root",
							message: `Command Version Probe Failed: ${packageManagerCommandName} ${error.detail}`,
						}),
				),
			);

			return buildContributions(config, runtimeVersion, packageManagerVersion);
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
		prepare: "lefthook install",
		typecheck: "turbo run typecheck",
	};

	const dbEnv =
		config.orm === "drizzle" ? ["DATABASE_URL", "DATABASE_DIRECT_URL"] : [];

	const buildTask: Record<string, unknown> = {
		dependsOn: ["^build"],
		inputs: ["$TURBO_DEFAULT$", ".env*"],
	};
	if (dbEnv.length > 0) buildTask.env = dbEnv;
	if (config.web === "nextjs")
		buildTask.outputs = [".next/**", "!.next/cache/**"];

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
		leafTextFile(projectTarget(), ".nvmrc", `${runtimeVersion}\n`),
	];
}

export default root;
