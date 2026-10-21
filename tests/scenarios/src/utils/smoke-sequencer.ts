import { basename } from "node:path";
import { BaseSequencer, type TestSpecification } from "vitest/node";

// Vitest's file size proxy misjudges smoke files, so these average a cold and a warm Install Smoke timing report.
const smokeFileSeconds: Readonly<Record<string, number>> = {
	"install-api-hosts.smoke.test.ts": 223,
	"install-auth.smoke.test.ts": 209,
	"install-self-host.smoke.test.ts": 198,
	"install-email.smoke.test.ts": 151,
	"install-database.smoke.test.ts": 144,
	"install-rpc-hosts.smoke.test.ts": 126,
	"install-mobile.smoke.test.ts": 108,
	"multi-pm.smoke.test.ts": 101,
	"install-web.smoke.test.ts": 87,
	"install-tooling.smoke.test.ts": 53,
	"install-production.smoke.test.ts": 36,
};

const unknownFileSeconds = 120;

function secondsOf(file: TestSpecification) {
	return smokeFileSeconds[basename(file.moduleId)] ?? unknownFileSeconds;
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
