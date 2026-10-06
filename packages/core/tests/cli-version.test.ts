import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { NodeServices } from "@effect/platform-node";
import { Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";
import {
	Apply,
	type ApplyPlan,
	CliVersion,
	CoreLive,
	compareCliVersions,
	State,
} from "../src/index";
import { readJson, withTempDir, writeJson } from "./harness";

const RUNNING_VERSION = "1.4.0";

const coreLayer = CoreLive.pipe(
	Layer.provide(Layer.succeed(CliVersion, { version: RUNNING_VERSION })),
	Layer.provideMerge(NodeServices.layer),
);

const plan: ApplyPlan = {
	lockfile: { artifacts: {} },
	manifest: { config: {}, installs: [], modules: {} },
	removals: [],
	writes: [{ content: "# project\n", path: "README.md" }],
};

async function snapshotTree(root: string) {
	const entries = await readdir(root, { recursive: true, withFileTypes: true });
	const files = entries.filter((entry) => entry.isFile());
	const contents = await Promise.all(
		files.map(async (entry) => {
			const path = join(entry.parentPath, entry.name);
			const file: [string, string] = [
				relative(root, path),
				await readFile(path, "utf-8"),
			];

			return file;
		}),
	);

	return Object.fromEntries(
		contents.sort(([left], [right]) => left.localeCompare(right)),
	);
}

async function seedManifest(directory: string, cliVersion?: string) {
	await writeJson(join(directory, ".forge/manifest.json"), {
		...(cliVersion === undefined ? {} : { cliVersion }),
		config: {},
		installs: [],
		modules: {},
		schemaVersion: 1,
	});
}

describe("compareCliVersions", () => {
	it.each([
		["1.4.0", "1.4.0", 0],
		["1.4.1", "1.4.0", 1],
		["1.10.0", "1.9.9", 1],
		["2.0.0", "10.0.0", -1],
		["1.4.0-beta.1", "1.4.0", -1],
		["1.4.0", "1.4.0-rc.1", 1],
		["1.4.0-beta.2", "1.4.0-beta.10", -1],
		["1.4.0-beta", "1.4.0-alpha", 1],
		["1.4.0-1", "1.4.0-alpha", -1],
		["1.4.0-alpha", "1.4.0-alpha.1", -1],
		["1.4.0+build.7", "1.4.0", 0],
	])("orders %s against %s as %i", (left, right, expected) => {
		expect(compareCliVersions(left, right)).toBe(expected);
	});

	it.each([
		["test-cli-version", "1.4.0"],
		["1.4.0", "v1.4.0"],
		["1.4", "1.4.0"],
		["01.4.0", "1.4.0"],
	])(
		"returns undefined when %s or %s is not a semver version",
		(left, right) => {
			expect(compareCliVersions(left, right)).toBeUndefined();
		},
	);
});

describe("older CLI guard", () => {
	it("refuses to apply over a manifest written by a newer CLI and writes nothing", async () => {
		await withTempDir("cli-version-newer", async (directory) => {
			await seedManifest(directory, "1.5.0-beta.1");
			const before = await snapshotTree(directory);

			const error = await Effect.runPromise(
				Effect.flip(
					Apply.applyPlan(directory, plan).pipe(Effect.provide(coreLayer)),
				),
			);

			expect(error).toMatchObject({
				_tag: "StateError",
				projectCliVersion: "1.5.0-beta.1",
				reason: "cli-version-older",
				runningCliVersion: RUNNING_VERSION,
			});

			expect(error.message).toBe(
				`This project was last changed by Forge 1.5.0-beta.1, but you're running Forge ${RUNNING_VERSION}. Run Forge 1.5.0-beta.1 or newer, for example with "npx @ryuugg/forge@latest", then try again.`,
			);

			expect(await snapshotTree(directory)).toEqual(before);
		});
	});

	it.each([
		["the same version", RUNNING_VERSION],
		["an older version", "1.3.9"],
		["an older prerelease", "1.4.0-rc.2"],
		["no version", undefined],
		["a version that is not semver", "next"],
	])(
		"applies over a manifest stamped with %s and stamps the running version",
		async (_label, cliVersion) => {
			await withTempDir("cli-version-allowed", async (directory) => {
				await seedManifest(directory, cliVersion);

				await Effect.runPromise(
					Apply.applyPlan(directory, plan).pipe(Effect.provide(coreLayer)),
				);

				expect(
					await readJson(join(directory, ".forge/manifest.json")),
				).toMatchObject({ cliVersion: RUNNING_VERSION });

				expect(await readFile(join(directory, "README.md"), "utf-8")).toBe(
					"# project\n",
				);
			});
		},
	);

	it("allows any manifest when the running CLI version is not semver", async () => {
		await withTempDir("cli-version-unversioned", async (directory) => {
			await Effect.runPromise(
				State.refuseOlderCli(directory, { cliVersion: "99.0.0" }).pipe(
					Effect.provide(
						CoreLive.pipe(
							Layer.provide(
								Layer.succeed(CliVersion, { version: "test-cli-version" }),
							),
							Layer.provideMerge(NodeServices.layer),
						),
					),
				),
			);
		});
	});
});
