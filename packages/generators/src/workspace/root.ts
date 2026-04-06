import { execFileSync } from "node:child_process";
import type { FileOperation } from "@ryuujs/core";
import {
	defineGenerator,
	filePath,
	GeneratorError,
	packageManagerCommand,
	runtimeCommand,
} from "@ryuujs/core";
import { Effect } from "effect";
import type { ForgeConfig } from "../config";
import { deps } from "../deps";

export default defineGenerator<ForgeConfig>({
	id: "workspace/root",
	name: "Root Workspace",
	version: "0.1.0",
	category: "workspace",
	exclusive: true,
	dependencies: [],

	appliesTo: () => true,

	generate: (config) =>
		Effect.gen(function* () {
			return buildOperations(
				config,
				yield* readCommandVersion(
					"workspace/root",
					runtimeCommand(config.runtime ?? "Node.js"),
				),
				yield* readCommandVersion(
					"workspace/root",
					packageManagerCommand(config.packageManager ?? "pnpm"),
				),
			);
		}),
});

function buildOperations(
	config: ForgeConfig,
	rtVersion: string,
	pmVersion: string,
): ReadonlyArray<FileOperation> {
	const slug = config.slug ?? "my-app";

	const rt = config.runtime ?? "Node.js";
	const rtCmd = runtimeCommand(rt);

	const pm = config.packageManager ?? "pnpm";
	const pmCmd = packageManagerCommand(pm);

	const packageJson: Record<string, unknown> = {
		name: slug,
		private: true,
		packageManager: `${pmCmd}@${pmVersion}`,
		engines: {
			[rtCmd]: rtVersion,
			[pmCmd]: `^${pmVersion}`,
		},
	};

	if (pmCmd !== "pnpm") packageJson.workspaces = ["apps/*", "packages/*"];

	return [
		{
			_tag: "CreateJson",
			path: filePath("package.json"),
			value: packageJson,
		},
		{
			_tag: "AddDependencies",
			path: filePath("package.json"),
			dependencies: [{ ...deps.turbo, type: "devDependencies" }],
		},
		{
			_tag: "AddScripts",
			path: filePath("package.json"),
			scripts: {
				build: "turbo run build",
				check: "turbo run check --continue",
				dev: "turbo run dev",
				typecheck: "turbo run typecheck",
			},
		},
		{
			_tag: "CreateJson",
			path: filePath("turbo.json"),
			value: {
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
			},
		},
	];
}

function readCommandVersion(
	generatorId: string,
	command: string,
): Effect.Effect<string, GeneratorError> {
	return Effect.try({
		try: () =>
			execFileSync(command, ["--version"], { encoding: "utf-8" })
				.trim()
				.replace(/^v/, ""),

		catch: (error) =>
			new GeneratorError({
				generatorId,
				message: `Command Version Probe Failed: ${command} ${(error as Error).message}`,
			}),
	});
}
