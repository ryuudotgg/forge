import {
	defineAddon,
	leafTextFile,
	projectTarget,
	surfaceDependencies,
	surfaceScripts,
} from "@ryuugg/core";
import { type ForgeConfig, hasAddon } from "../config";
import { deps } from "../deps";
import { toolingFor } from "../linters/tooling";
import { pmExec, resolvePackageManager } from "../pm";
import type { FirstPartyAddonMetadata } from "../registry/types";
import { interpolate, readTemplate } from "../template";

const lefthook = defineAddon<ForgeConfig, "lefthook">({
	id: "lefthook",
	name: "Lefthook",
	version: "0.1.0",
	category: "tooling",
	exclusive: false,
	targetMode: "single",
	when: (config) => hasAddon(config, "lefthook"),
	contribute: ({ config }) => {
		const pm = resolvePackageManager(config);

		const lines = toolingFor(config)?.preCommit(pm) ?? [];
		const preCommit =
			lines.length > 0
				? interpolate(readTemplate("tooling/lefthook/lefthook.yml"), {
						PRE_COMMIT_JOBS: [...lines, "git update-index --again"]
							.map((line) => `    - run: ${line}`)
							.join("\n"),
					})
				: "";

		const commitMsg = interpolate(
			readTemplate("tooling/lefthook/commit-msg.yml"),
			{ COMMITLINT_COMMAND: pmExec(pm, "commitlint") },
		);

		const hooks =
			[hasAddon(config, "commitlint") ? commitMsg : "", preCommit]
				.filter(Boolean)
				.join("\n") || "{}\n";

		return [
			leafTextFile(projectTarget(), "lefthook.yml", hooks),
			surfaceDependencies(projectTarget(), "rootPackageJson", [
				{ ...deps.lefthook, type: "devDependencies" },
			]),
			surfaceScripts(projectTarget(), "rootPackageJson", {
				prepare: "lefthook install",
			}),
		];
	},
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
