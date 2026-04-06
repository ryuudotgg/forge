import { execFileSync } from "node:child_process";
import type { FileOperation } from "@ryuujs/core";
import {
	defineGenerator,
	filePath,
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

	generate: (config) => Effect.succeed(buildOperations(config)),
});

function buildOperations(config: ForgeConfig): ReadonlyArray<FileOperation> {
	const slug = config.slug ?? "my-app";

	const rt = config.runtime ?? "Node.js";
	const rtCmd = runtimeCommand(rt);

	const rtVersion = execFileSync(rtCmd, ["--version"], {
		encoding: "utf-8",
	})
		.trim()
		.replace(/^v/, "");

	const pm = config.packageManager ?? "pnpm";
	const pmCmd = packageManagerCommand(pm);

	const pmVersion = execFileSync(pmCmd, ["--version"], {
		encoding: "utf-8",
	})
		.trim()
		.replace(/^v/, "");

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
