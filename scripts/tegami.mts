import { spawnSync } from "node:child_process";
import type { PackageGraph, TegamiPlugin } from "tegami";
import { tegami } from "tegami";
import { runCli } from "tegami/cli";
import { github } from "tegami/plugins/github";
import { isCI } from "tegami/utils";

const [command, ...flags] = process.argv.slice(2);
let applied = false;

function forge(): TegamiPlugin {
	return {
		name: "forge",
		enforce: "pre",
		initPublishPlan({ plan }) {
			for (const [id, packagePlan] of plan.packages) {
				const pkg = this.graph.get(id);
				if (pkg?.version)
					packagePlan.git = { ...packagePlan.git, tag: `v${pkg.version}` };
			}
		},
		initCliDraft(draft) {
			if (command === "version" && !draft.hasPending())
				throw new Error(
					"No Pending Change Files: add one under .tegami/ naming group:forge",
				);
		},
		applyCliDraft() {
			applied = true;
		},
		beforePublishAll({ plan }) {
			if (!plan.options.dryRun && !isCI())
				throw new Error(
					"Publish Outside CI: the Publish workflow on main is the only publisher",
				);
		},
		willPublish({ pkg }) {
			const result = spawnSync(
				"pnpm",
				["exec", "turbo", "run", "build", "--filter", pkg.name],
				{ cwd: this.cwd, stdio: "inherit" },
			);

			if (result.status !== 0) throw new Error(`Build Failed: ${pkg.name}`);
		},
	};
}

function releaseTitle(graph: PackageGraph) {
	return `chore: release ${graph.getByName("@ryuugg/forge")[0]?.version}`;
}

const paper = tegami({
	groups: {
		forge: { syncBump: true, syncGitTag: true },
	},
	npm: { client: "pnpm" },
	packages: {
		"@ryuugg/core": { group: "forge" },
		"@ryuugg/forge": { group: "forge" },
		"@ryuugg/generators": { group: "forge" },
	},
	plugins: [
		github({
			versionPr: {
				create() {
					return { title: releaseTitle(this.graph) };
				},
				commit({ type }) {
					if (type === "version-packages")
						return { title: releaseTitle(this.graph) };
				},
			},
		}),
		forge(),
	],
});

async function previewVersion() {
	const draft = await paper.draft();
	const { graph } = await paper._internal.context();
	for (const pkg of graph.getPackages()) {
		const bumped = draft.getPackageDraft(pkg.id)?.bumpVersion(pkg);
		if (pkg.version && bumped && bumped !== pkg.version)
			console.log(`${pkg.id}: ${pkg.version} -> ${bumped}`);
	}
}

if (command === "version" && flags.includes("--dry-run"))
	await previewVersion();
else await runCli(paper);

if (command === "version" && !flags.includes("--dry-run") && !applied) {
	console.error("No Publish Lock: tegami version wrote nothing");
	process.exitCode = 1;
}
