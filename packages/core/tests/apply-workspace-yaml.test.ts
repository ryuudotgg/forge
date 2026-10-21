import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { NodeServices } from "@effect/platform-node";
import { Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";
import { unifiedDiff } from "../src/diff";
import {
	Apply,
	type ArtifactBase,
	CliVersion,
	CoreLive,
	type Lockfile,
	type LockfileArtifact,
	type ResolutionPolicy,
} from "../src/index";
import { hashContent, readJson, withTempDir, writeText } from "./harness";

const coreLayer = CoreLive.pipe(
	Layer.provide(Layer.succeed(CliVersion, { version: "test-cli-version" })),
	Layer.provideMerge(NodeServices.layer),
);

const artifactId = "project:file:pnpm-workspace.yaml";
const path = "pnpm-workspace.yaml";

const base = `packages:
  - "apps/*"
  - "packages/*"

catalog:
  # Build
  tsdown: 0.1.0
  typescript: 5.0.0

  # Testing
  vitest: 3.0.0
  jsdom: 20.0.0

allowBuilds:
  esbuild: true
`;

const user = `packages:
  - "apps/*"
  - "packages/*"
  - "docs/*"

catalog:
  # Build
  tsdown: 0.1.0
  typescript: 5.0.0
  fumadocs-core: 15.0.0

  # Testing
  vitest: 3.0.0
  jsdom: 20.0.0

  # Docs
  fumadocs-ui: 15.0.0
  fumadocs-mdx: 11.0.0

allowBuilds:
  esbuild: true
  sharp: true
`;

const incoming = `packages:
  - "apps/*"
  - "packages/*"
  - "tooling/*"

catalog:
  # Build
  tsdown: 0.1.0
  typescript: 5.1.0

  # Testing
  vitest: 3.1.0
  "@vitest/coverage-v8": 3.1.0

allowBuilds:
  "@parcel/watcher": true
  esbuild: true
`;

const merged = `packages:
  - "apps/*"
  - "packages/*"
  - "tooling/*"
  - "docs/*"

catalog:
  # Build
  tsdown: 0.1.0
  typescript: 5.1.0
  fumadocs-core: 15.0.0

  # Testing
  vitest: 3.1.0
  "@vitest/coverage-v8": 3.1.0

  # Docs
  fumadocs-ui: 15.0.0
  fumadocs-mdx: 11.0.0

allowBuilds:
  "@parcel/watcher": true
  esbuild: true
  sharp: true
`;

async function yamlArtifact(content: string): Promise<LockfileArtifact> {
	const hash = await hashContent(content);
	return {
		base: { hash, mergeKind: "yaml", semanticsVersion: 1 },
		definitionIds: ["pnpm"],
		hash,
		kind: "file",
		path,
	};
}

function apply(
	directory: string,
	content: string,
	artifact: LockfileArtifact,
	resolutionPolicy: ResolutionPolicy = "refuse",
) {
	return Apply.applyPlan(
		directory,
		{
			lockfile: { artifacts: { [artifactId]: artifact } },
			manifest: { config: {}, installs: [], modules: {} },
			removals: [],
			writes: [{ artifactId, content, path }],
		},
		{ resolutionPolicy },
	).pipe(Effect.provide(coreLayer));
}

async function scaffold(directory: string, rendered: string) {
	await Effect.runPromise(
		apply(directory, rendered, await yamlArtifact(rendered)),
	);
}

async function readLockedBase(
	directory: string,
): Promise<ArtifactBase | undefined> {
	const lockfile = await readJson<Lockfile>(
		join(directory, ".forge/lock.json"),
	);

	return lockfile.artifacts[artifactId]?.base;
}

describe("pnpm-workspace.yaml key merge", () => {
	it("lands every Forge change and keeps every user entry without a flag", async () => {
		await withTempDir("apply-workspace-yaml-merge", async (directory) => {
			await scaffold(directory, base);
			await writeText(join(directory, path), user);

			await Effect.runPromise(
				apply(directory, incoming, await yamlArtifact(incoming)),
			);

			expect(await readFile(join(directory, path), "utf-8")).toBe(merged);
			expect(await readLockedBase(directory)).toEqual({
				hash: await hashContent(incoming),
				mergeKind: "yaml",
				semanticsVersion: 1,
			});
		});
	});

	it("refuses only the key both sides changed and names it", async () => {
		await withTempDir("apply-workspace-yaml-conflict", async (directory) => {
			await scaffold(directory, base);
			const edited = user.replace("vitest: 3.0.0", "vitest: 3.0.5");
			await writeText(join(directory, path), edited);

			const error = await Effect.runPromise(
				Effect.flip(apply(directory, incoming, await yamlArtifact(incoming))),
			);

			expect(error).toMatchObject({
				_tag: "ApplyError",
				preflight: {
					conflicts: [
						{
							base: "3.0.0",
							forge: "3.1.0",
							label: "pnpm-workspace.yaml -> catalog.vitest",
							user: "3.0.5",
						},
					],
					refusals: [],
				},
			});

			expect(error.message).toBe(
				'Semantic merge conflicts were found:\npnpm-workspace.yaml -> catalog.vitest: base was "3.0.0", user has "3.0.5", and forge wants "3.1.0".\nResolve each conflict, then run Forge again.',
			);

			expect(await readFile(join(directory, path), "utf-8")).toBe(edited);
		});
	});

	it.each([
		{ policy: "keep-user", vitest: "3.0.5" },
		{ policy: "accept-forge", vitest: "3.1.0" },
	] satisfies ReadonlyArray<{ policy: ResolutionPolicy; vitest: string }>)(
		"resolves only the conflicting key with $policy",
		async ({ policy, vitest }) => {
			await withTempDir("apply-workspace-yaml-resolve", async (directory) => {
				await scaffold(directory, base);
				await writeText(
					join(directory, path),
					user.replace("vitest: 3.0.0", "vitest: 3.0.5"),
				);

				await Effect.runPromise(
					apply(directory, incoming, await yamlArtifact(incoming), policy),
				);

				expect(await readFile(join(directory, path), "utf-8")).toBe(
					merged.replace("vitest: 3.1.0", `vitest: ${vitest}`),
				);
			});
		},
	);

	it("writes the new render over an unedited file from an older lockfile", async () => {
		await withTempDir(
			"apply-workspace-yaml-legacy-clean",
			async (directory) => {
				await Effect.runPromise(
					apply(directory, base, {
						definitionIds: ["pnpm"],
						hash: await hashContent(base),
						kind: "file",
						path,
					}),
				);

				await Effect.runPromise(
					apply(directory, incoming, await yamlArtifact(incoming)),
				);

				expect(await readFile(join(directory, path), "utf-8")).toBe(incoming);
				expect(await readLockedBase(directory)).toMatchObject({
					mergeKind: "yaml",
				});
			},
		);
	});

	it("asks about every user side difference when an older lockfile stored no base", async () => {
		await withTempDir("apply-workspace-yaml-legacy", async (directory) => {
			const hash = await hashContent(base);
			await Effect.runPromise(
				apply(directory, base, {
					definitionIds: ["pnpm"],
					hash,
					kind: "file",
					path,
				}),
			);

			await writeText(join(directory, path), user);

			const error = await Effect.runPromise(
				Effect.flip(apply(directory, incoming, await yamlArtifact(incoming))),
			);

			const conflicts =
				error._tag === "ApplyError" ? (error.preflight?.conflicts ?? []) : [];

			const labels = conflicts.map((conflict) => conflict.label);

			expect(labels).toEqual(
				expect.arrayContaining([
					"pnpm-workspace.yaml -> catalog.typescript",
					'pnpm-workspace.yaml -> catalog["fumadocs-core"]',
					"pnpm-workspace.yaml -> catalog.jsdom",
				]),
			);

			const userOwned = new Set([
				'pnpm-workspace.yaml -> catalog["fumadocs-core"]',
				'pnpm-workspace.yaml -> catalog["fumadocs-ui"]',
				'pnpm-workspace.yaml -> catalog["fumadocs-mdx"]',
				"pnpm-workspace.yaml -> allowBuilds.sharp",
				'pnpm-workspace.yaml -> packages["docs/*"]',
			]);

			await Effect.runPromise(
				Apply.applyPlan(
					directory,
					{
						lockfile: {
							artifacts: { [artifactId]: await yamlArtifact(incoming) },
						},
						manifest: { config: {}, installs: [], modules: {} },
						removals: [],
						writes: [{ artifactId, content: incoming, path }],
					},
					{
						conflictResolutions: Object.fromEntries(
							labels.map((label) => [
								label,
								{ resolution: userOwned.has(label) ? "user" : "forge" },
							]),
						),
					},
				).pipe(Effect.provide(coreLayer)),
			);

			expect(await readFile(join(directory, path), "utf-8")).toBe(merged);
			expect(await readLockedBase(directory)).toMatchObject({
				mergeKind: "yaml",
			});
		});
	});

	it("reports the Forge side it skipped when an older lockfile stored no base and the user wins", async () => {
		await withTempDir("apply-workspace-yaml-legacy-user", async (directory) => {
			await Effect.runPromise(
				apply(directory, base, {
					definitionIds: ["pnpm"],
					hash: await hashContent(base),
					kind: "file",
					path,
				}),
			);

			await writeText(join(directory, path), user);

			const result = await Effect.runPromise(
				apply(directory, incoming, await yamlArtifact(incoming), "keep-user"),
			);

			expect(await readFile(join(directory, path), "utf-8")).toBe(
				user
					.replace('  - "docs/*"', '  - "tooling/*"\n  - "docs/*"')
					.replace(
						"  vitest: 3.0.0\n",
						'  vitest: 3.0.0\n  "@vitest/coverage-v8": 3.1.0\n',
					)
					.replace(
						"  esbuild: true",
						'  "@parcel/watcher": true\n  esbuild: true',
					),
			);

			expect(result.declined.map((change) => change.path)).toEqual([path]);
		});
	});

	it("merges against the stored render when the previous base was opaque", async () => {
		await withTempDir("apply-workspace-yaml-opaque", async (directory) => {
			const hash = await hashContent(base);
			await Effect.runPromise(
				apply(directory, base, {
					base: { hash, mergeKind: "opaque", semanticsVersion: 1 },
					definitionIds: ["pnpm"],
					hash,
					kind: "file",
					path,
				}),
			);

			await writeText(join(directory, path), user);

			await Effect.runPromise(
				apply(directory, incoming, await yamlArtifact(incoming)),
			);

			expect(await readFile(join(directory, path), "utf-8")).toBe(merged);
		});
	});

	it("refuses the whole file when the user's edit cannot be split into keys", async () => {
		await withTempDir("apply-workspace-yaml-unparseable", async (directory) => {
			await scaffold(directory, base);
			await writeText(join(directory, path), "- apps/*\n");

			const error = await Effect.runPromise(
				Effect.flip(apply(directory, incoming, await yamlArtifact(incoming))),
			);

			expect(error).toMatchObject({
				_tag: "ApplyError",
				path,
				reason: "managed-file-modified",
			});
		});
	});

	it("keeps an edit that cannot be split into keys with keep-user and reports Forge's change", async () => {
		await withTempDir(
			"apply-workspace-yaml-unparseable-keep",
			async (directory) => {
				await scaffold(directory, base);
				await writeText(join(directory, path), "- apps/*\n");

				const result = await Effect.runPromise(
					apply(directory, incoming, await yamlArtifact(incoming), "keep-user"),
				);

				expect(await readFile(join(directory, path), "utf-8")).toBe(
					"- apps/*\n",
				);
				expect(result.declined).toEqual([
					expect.objectContaining({
						path,
						diff: unifiedDiff(path, base, incoming),
					}),
				]);
			},
		);
	});

	it("fails loudly when Forge's own render cannot be split into keys", async () => {
		await withTempDir("apply-workspace-yaml-bad-render", async (directory) => {
			await scaffold(directory, base);
			await writeText(join(directory, path), user);

			const broken = "- apps/*\n";
			const error = await Effect.runPromise(
				Effect.flip(apply(directory, broken, await yamlArtifact(broken))),
			);

			expect(error).toMatchObject({
				_tag: "ApplyError",
				detail: `Managed YAML Parse Failed: ${path} (incoming)`,
			});
		});
	});
});
