import {
	CommandProbe,
	defineAddon,
	GeneratorError,
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
		packageJson.workspaces = ["apps/*", "packages/*"];

	return [
		surfaceJson(projectTarget(), "rootPackageJson", packageJson),
		surfaceDependencies(projectTarget(), "rootPackageJson", [
			{ ...deps.turbo, type: "devDependencies" },
		]),
		surfaceScripts(projectTarget(), "rootPackageJson", {
			build: "turbo run build",
			check: "turbo run check --continue",
			dev: "turbo run dev",
			typecheck: "turbo run typecheck",
		}),
		surfaceJson(projectTarget(), "workspaceConfig", {
			$schema: "https://turborepo.com/schema.json",
			tasks: {
				build: {
					dependsOn: ["^build"],
					outputs: ["dist/**", ".next/**", "!.next/cache/**"],
				},
				check: {
					dependsOn: ["^build"],
				},
				dev: {
					cache: false,
					persistent: true,
				},
				typecheck: {
					dependsOn: ["^build"],
					outputs: [".cache/tsbuildinfo.json"],
				},
			},
		}),
	];
}

export default root;
