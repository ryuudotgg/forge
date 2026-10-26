import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { NodeServices } from "@effect/platform-node";
import { Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";
import {
	Apply,
	type ApplyPlan,
	type ApplyResult,
	CliVersion,
	CoreLive,
	type Lockfile,
} from "../src/index";
import { hashContent, readJson, withTempDir, writeText } from "./harness";

const coreLayer = CoreLive.pipe(
	Layer.provide(Layer.succeed(CliVersion, { version: "test-cli-version" })),
	Layer.provideMerge(NodeServices.layer),
);

const layout = "packages/email/src/layout.tsx";
const invitation = "packages/email/src/templates/invitation.tsx";
const magicLink = "packages/email/src/templates/magic-link.tsx";
const companion = "packages/email/src/verification-code.test.ts";
const group = "project:email:email-design";

type Policy = "managed" | "starter" | "grouped" | "companion";

interface Version {
	readonly [path: string]: string;
}

async function planOf(
	files: Version,
	policy: Policy | ((path: string) => Policy) = "grouped",
): Promise<ApplyPlan> {
	const entries = Object.entries(files).map(([path, content]) => ({
		id: `project:file:${path}`,
		path,
		content,
		policy: typeof policy === "function" ? policy(path) : policy,
	}));

	const artifacts: Record<string, Lockfile["artifacts"][string]> = {};
	for (const entry of entries)
		artifacts[entry.id] = {
			definitionIds: ["email"],
			hash: await hashContent(entry.content),
			kind: "file",
			path: entry.path,
			...(entry.policy === "managed" ? {} : { update: "starter" }),
		};

	return {
		lockfile: { artifacts },
		manifest: { config: {}, installs: [], modules: {} },
		removals: [],
		writes: entries.map((entry) => ({
			artifactId: entry.id,
			content: entry.content,
			path: entry.path,
			...(entry.policy === "managed"
				? {}
				: entry.policy === "starter"
					? { update: "starter" }
					: {
							update: "starter",
							group: { key: group, companion: entry.policy === "companion" },
						}),
		})),
	};
}

const design = (version: string): Version => ({
	[layout]: `layout ${version}\n`,
	[invitation]: `invitation ${version}\n`,
	[magicLink]: `magic link ${version}\n`,
});

function apply(directory: string, plan: ApplyPlan): Promise<ApplyResult> {
	return Effect.runPromise(
		Apply.applyPlan(directory, plan).pipe(Effect.provide(coreLayer)),
	);
}

const read = (directory: string, path: string) =>
	readFile(join(directory, path), "utf-8");

async function lockOf(directory: string, path: string) {
	const lock = await readJson<Lockfile>(join(directory, ".forge/lock.json"));
	return lock.artifacts[`project:file:${path}`];
}

async function owners(directory: string, paths: ReadonlyArray<string>) {
	return Promise.all(
		paths.map(async (path) => (await lockOf(directory, path))?.owner),
	);
}

const members = [layout, invitation, magicLink];

describe("starter groups", () => {
	it("updates every member of an untouched group", async () => {
		await withTempDir("apply-group-untouched", async (directory) => {
			await apply(directory, await planOf(design("v1"), "managed"));
			const result = await apply(directory, await planOf(design("v2")));

			for (const [path, content] of Object.entries(design("v2")))
				expect(await read(directory, path)).toBe(content);

			expect(result.released).toEqual([]);
			expect(await owners(directory, members)).toEqual([
				undefined,
				undefined,
				undefined,
			]);
		});
	});

	it("leaves the whole group alone once one member is edited", async () => {
		await withTempDir("apply-group-edited", async (directory) => {
			await apply(directory, await planOf(design("v1"), "managed"));
			await writeText(join(directory, layout), "my layout\n");

			const result = await apply(directory, await planOf(design("v2")));

			expect(await read(directory, layout)).toBe("my layout\n");
			expect(await read(directory, invitation)).toBe("invitation v1\n");
			expect(await read(directory, magicLink)).toBe("magic link v1\n");
			expect(result.released).toEqual([{ paths: members, heldBy: [layout] }]);
			expect(await owners(directory, members)).toEqual([
				"user",
				"user",
				"user",
			]);

			expect((await lockOf(directory, invitation))?.hash).toBe(
				await hashContent("invitation v1\n"),
			);

			const again = await apply(directory, await planOf(design("v3")));

			expect(again).toEqual({
				declined: [],
				dropped: [],
				released: [],
				retained: [],
			});

			expect(await read(directory, invitation)).toBe("invitation v1\n");
		});
	});

	it("extends an earlier single file release to the rest of its group", async () => {
		await withTempDir("apply-group-legacy-owner", async (directory) => {
			await apply(directory, await planOf(design("v1"), "managed"));
			await writeText(join(directory, layout), "my layout\n");
			await apply(
				directory,
				await planOf(design("v2"), (path) =>
					path === layout ? "grouped" : "managed",
				),
			);

			expect((await lockOf(directory, layout))?.owner).toBe("user");
			expect(await read(directory, invitation)).toBe("invitation v2\n");

			const result = await apply(directory, await planOf(design("v3")));

			expect(await read(directory, invitation)).toBe("invitation v2\n");
			expect(result.released).toEqual([{ paths: members, heldBy: [layout] }]);
			expect(await owners(directory, members)).toEqual([
				"user",
				"user",
				"user",
			]);
		});
	});

	it("writes a deleted member back only while the rest of its group is untouched", async () => {
		await withTempDir("apply-group-deleted", async (directory) => {
			await apply(directory, await planOf(design("v1")));
			await rm(join(directory, magicLink));
			await apply(directory, await planOf(design("v2")));

			expect(await read(directory, magicLink)).toBe("magic link v2\n");
			expect((await lockOf(directory, magicLink))?.owner).toBeUndefined();

			await writeText(join(directory, layout), "my layout\n");
			await rm(join(directory, magicLink));

			for (const version of ["v3", "v4"]) {
				const result = await apply(directory, await planOf(design(version)));

				await expect(read(directory, magicLink)).rejects.toThrow();
				expect((await lockOf(directory, magicLink))?.owner).toBe("user");
				expect(result.released).toEqual(
					version === "v3"
						? [{ paths: [layout, invitation], heldBy: [layout] }]
						: [],
				);
			}

			for (const path of members)
				await rm(join(directory, path), { force: true });

			const restored = await apply(directory, await planOf(design("v5")));

			for (const [path, content] of Object.entries(design("v5")))
				expect(await read(directory, path)).toBe(content);

			expect(restored.released).toEqual([]);
			expect(await owners(directory, members)).toEqual([
				undefined,
				undefined,
				undefined,
			]);
		});
	});

	it("writes a new member into a held group as the user's, but not a new companion", async () => {
		await withTempDir("apply-group-new-member", async (directory) => {
			const { [magicLink]: _, ...withoutMagicLink } = design("v1");
			await apply(directory, await planOf(withoutMagicLink));
			await writeText(join(directory, layout), "my layout\n");
			await apply(directory, await planOf(withoutMagicLink));

			const result = await apply(
				directory,
				await planOf({ ...design("v2"), [companion]: "test v2\n" }, (path) =>
					path === companion ? "companion" : "grouped",
				),
			);

			expect(await read(directory, magicLink)).toBe("magic link v2\n");
			expect((await lockOf(directory, magicLink))?.owner).toBe("user");

			await expect(read(directory, companion)).rejects.toThrow();
			expect(await lockOf(directory, companion)).toBeUndefined();

			expect(await read(directory, invitation)).toBe("invitation v1\n");
			expect(result.released).toEqual([]);
		});
	});

	it("writes a new companion into an untouched group", async () => {
		await withTempDir("apply-group-companion", async (directory) => {
			await apply(directory, await planOf(design("v1")));

			await apply(
				directory,
				await planOf({ ...design("v2"), [companion]: "test v2\n" }, (path) =>
					path === companion ? "companion" : "grouped",
				),
			);

			expect(await read(directory, companion)).toBe("test v2\n");
			expect((await lockOf(directory, companion))?.update).toBe("starter");
			expect(await read(directory, invitation)).toBe("invitation v2\n");
		});
	});

	it("releases starters outside any group together", async () => {
		await withTempDir("apply-group-ungrouped", async (directory) => {
			await apply(directory, await planOf(design("v1"), "starter"));
			await writeText(join(directory, layout), "my layout\n");
			await writeText(join(directory, magicLink), "my magic link\n");

			const result = await apply(
				directory,
				await planOf(design("v2"), "starter"),
			);

			expect(await read(directory, invitation)).toBe("invitation v2\n");
			expect(result.released).toEqual([
				{ paths: [layout, magicLink], heldBy: [layout, magicLink] },
			]);
		});
	});

	it("reports a held group and a released single starter on their own lines", async () => {
		await withTempDir("apply-group-two-releases", async (directory) => {
			const single = "packages/email/src/custom.tsx";
			const files = (version: string) => ({
				...design(version),
				[single]: `custom ${version}\n`,
			});

			const policy = (path: string): Policy =>
				path === single ? "starter" : "grouped";

			await apply(directory, await planOf(files("v1"), policy));
			await writeText(join(directory, single), "my custom\n");
			await writeText(join(directory, magicLink), "my magic link\n");

			const result = await apply(directory, await planOf(files("v2"), policy));

			expect(result.released).toEqual([
				{ paths: [single], heldBy: [single] },
				{ paths: members, heldBy: [magicLink] },
			]);
		});
	});

	it("keeps every member of a held group when Forge stops planning it", async () => {
		await withTempDir("apply-group-removal", async (directory) => {
			await apply(directory, await planOf(design("v1")));
			await writeText(join(directory, layout), "my layout\n");
			await apply(directory, await planOf(design("v2")));

			const result = await apply(directory, {
				...(await planOf({})),
				removals: members,
			});

			expect(result.retained).toEqual(members);
			expect(await read(directory, invitation)).toBe("invitation v1\n");
		});
	});
});
