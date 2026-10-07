import { basename } from "node:path";
import { BaseSequencer, type TestSpecification } from "vitest/node";

// Vitest's file size proxy misjudges smoke files, so these come from a cold Install Smoke timing report.
const coldSmokeSeconds: Readonly<Record<string, number>> = {
	"install-api-hosts.smoke.test.ts": 324,
	"install-auth.smoke.test.ts": 302,
	"install-self-host.smoke.test.ts": 290,
	"install-database.smoke.test.ts": 211,
	"install-email.smoke.test.ts": 196,
	"install-rpc-hosts.smoke.test.ts": 178,
	"install-web.smoke.test.ts": 136,
	"install-mobile.smoke.test.ts": 103,
	"install-tooling.smoke.test.ts": 86,
	"multi-pm.smoke.test.ts": 68,
	"install-production.smoke.test.ts": 57,
};

const unknownFileSeconds = 150;

function secondsOf(file: TestSpecification) {
	return coldSmokeSeconds[basename(file.moduleId)] ?? unknownFileSeconds;
}

function longestFirst(files: ReadonlyArray<TestSpecification>) {
	return [...files].sort(
		(first, second) => secondsOf(second) - secondsOf(first),
	);
}

export class SmokeSequencer extends BaseSequencer {
	override async shard(files: TestSpecification[]) {
		const shard = this.ctx.config.shard;
		if (!shard) return files;

		const shards = Array.from(
			{ length: shard.count },
			(): { files: TestSpecification[]; seconds: number } => ({
				files: [],
				seconds: 0,
			}),
		);

		const byPath = [...files].sort((first, second) =>
			first.moduleId.localeCompare(second.moduleId),
		);

		for (const file of longestFirst(byPath)) {
			const lightest = shards.reduce((least, candidate) =>
				candidate.seconds < least.seconds ? candidate : least,
			);

			lightest.files.push(file);
			lightest.seconds += secondsOf(file);
		}

		return shards[shard.index - 1]?.files ?? [];
	}

	override async sort(files: TestSpecification[]) {
		return longestFirst(await super.sort(files));
	}
}
