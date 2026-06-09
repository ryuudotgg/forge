import {
	defineAddon,
	leafTextFile,
	projectTarget,
	surfaceDependencies,
} from "@ryuujs/core";
import type { ForgeConfig } from "../config";
import { deps } from "../deps";
import type { FirstPartyAddonMetadata } from "../registry/types";
import { readTemplate } from "../template";

const lefthook = defineAddon<ForgeConfig, "lefthook">({
	id: "lefthook",
	name: "Lefthook",
	version: "0.1.0",
	category: "tooling",
	exclusive: false,
	targetMode: "single",
	when: () => true,
	contribute: () => [
		leafTextFile(
			projectTarget(),
			"lefthook.yml",
			readTemplate("tooling/lefthook/lefthook.yml"),
		),
		surfaceDependencies(projectTarget(), "rootPackageJson", [
			{ ...deps.lefthook, type: "devDependencies" },
		]),
	],
});

export const lefthookMetadata = {
	description:
		"Git hooks via lefthook for pre-commit formatting and commit-msg linting.",
	experimental: false,
	hidden: false,
	id: "lefthook",
	keywords: ["git", "hooks", "lefthook", "tooling"],
	kind: "addon",
	name: "Lefthook",
	summary: "Add lefthook git hooks.",
} as const satisfies FirstPartyAddonMetadata;

export default lefthook;
