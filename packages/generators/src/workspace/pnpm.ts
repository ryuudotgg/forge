import { defineGenerator, filePath } from "@ryuujs/core";
import { Effect } from "effect";
import type { ForgeConfig } from "../config";

export default defineGenerator<ForgeConfig>({
	id: "workspace/pnpm",
	name: "pnpm Workspace",
	version: "0.1.0",
	category: "packageManager",
	exclusive: true,
	dependencies: [],

	appliesTo: (config) =>
		config.packageManager === "pnpm" || config.packageManager === undefined,

	generate: () =>
		Effect.succeed([
			{
				_tag: "CreateFile",
				path: filePath("pnpm-workspace.yaml"),
				content: "packages:\n  - apps/*\n  - packages/*\n",
				overwrite: false,
			},
		]),
});
