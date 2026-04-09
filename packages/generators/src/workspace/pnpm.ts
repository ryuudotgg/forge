import { defineAddon, leafTextFile, projectTarget } from "@ryuujs/core";
import type { ForgeConfig } from "../config";

const pnpm = defineAddon<ForgeConfig, "pnpm">({
	id: "pnpm",
	name: "pnpm Workspace",
	version: "0.1.0",
	category: "packageManager",
	exclusive: true,
	targetMode: "single",
	when: (config) =>
		config.packageManager === "pnpm" || config.packageManager === undefined,
	contribute: () => [
		leafTextFile(
			projectTarget(),
			"pnpm-workspace.yaml",
			"packages:\n  - apps/*\n  - packages/*\n",
		),
	],
});

export default pnpm;
