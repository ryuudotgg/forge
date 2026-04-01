import type { FileOperation } from "@ryuujs/core";
import { defineGenerator, filePath } from "@ryuujs/core";
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
	const pm = config.packageManager ?? "pnpm";

	const packageJson: Record<string, unknown> = {
		name: slug,
		private: true,
	};

	if (pm !== "pnpm") packageJson.workspaces = ["apps/*", "packages/*"];

	return [
		{
			_tag: "CreateFile",
			path: filePath("package.json"),
			content: `${JSON.stringify(packageJson, null, "\t")}\n`,
			overwrite: false,
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
			_tag: "CreateFile",
			path: filePath("turbo.json"),
			content: `${JSON.stringify(
				{
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
				null,
				"\t",
			)}\n`,
			overwrite: false,
		},
	];
}
