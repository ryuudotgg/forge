import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import { NodeContext } from "@effect/platform-node";
import { Apply, CoreLive, Planner, State } from "@ryuujs/core";
import { builtins, type ForgeConfig } from "@ryuujs/generators";
import { Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";
import { readJson, withTempDir } from "./harness";

const coreLayer = CoreLive.pipe(Layer.provideMerge(NodeContext.layer));

async function pathExists(path: string) {
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
}

describe("planner-backed create", () => {
	it("writes root state and module metadata from planner output", async () => {
		await withTempDir("planner-create", async (directory) => {
			const config: ForgeConfig = {
				linter: "biome",
				orm: "drizzle",
				packageManager: "pnpm",
				rpc: "trpc",
				runtime: "Node.js",
				slug: "acme",
				style: "tailwind",
				web: "nextjs",
			};

			const plan = await Effect.runPromise(
				Effect.flatMap(Planner, (planner) =>
					planner.planCreate(directory, config, builtins),
				).pipe(Effect.provide(coreLayer)),
			);

			await Effect.runPromise(
				Apply.applyPlan(directory, {
					lockfile: plan.lockfile,
					manifest: plan.manifest,
					removals: plan.removals,
					writes: plan.writes.map((write) => ({
						content: write.content,
						path: write.path,
					})),
				}).pipe(Effect.provide(coreLayer)),
			);

			const manifest = await readJson<{
				config: Record<string, unknown>;
				installs: Array<{ definitionId: string; targets: unknown[] }>;
				modules: Record<string, object>;
			}>(join(directory, ".forge/manifest.json"));

			const lockfile = await readJson<{
				provenance: {
					artifacts: Record<string, unknown>;
				};
			}>(join(directory, ".forge/lock.json"));

			const appConfig = await readJson<{
				framework: string;
				id: string;
				slots: Record<string, string>;
				template: { id: string; version: number };
				type: string;
			}>(join(directory, "apps/web/forge.json"));

			const uiConfig = await readJson<{
				capabilities: string[];
				id: string;
				packageType: string;
				slots: Record<string, string>;
				template: { id: string; version: number };
				type: string;
			}>(join(directory, "packages/ui/forge.json"));

			expect(manifest.config.slug).toBe("acme");
			expect(manifest.installs.map((install) => install.definitionId)).toEqual(
				expect.arrayContaining([
					"root",
					"pnpm",
					"typescript",
					"biome",
					"ui",
					"tailwind",
					"trpc",
					"drizzle",
				]),
			);
			expect(Object.keys(manifest.modules)).toEqual(
				expect.arrayContaining([appConfig.id, uiConfig.id]),
			);

			expect(appConfig.type).toBe("app");
			expect(appConfig.framework).toBe("nextjs");
			expect(appConfig.template).toEqual({ id: "base", version: 1 });
			expect(appConfig.slots).toMatchObject({
				auth: "src/lib/auth.ts",
				authClient: "src/lib/auth-client.ts",
				db: "src/db",
				layout: "app/layout.tsx",
				page: "app/page.tsx",
				trpc: "src/trpc",
			});

			expect(uiConfig.type).toBe("package");
			expect(uiConfig.packageType).toBe("library");
			expect(uiConfig.capabilities).toEqual(
				expect.arrayContaining(["react", "tailwind", "ui"]),
			);
			expect(uiConfig.slots).toMatchObject({
				globalsCss: "src/styles/globals.css",
				postcssConfig: "postcss.config.mjs",
				themeCss: "src/styles/theme.css",
				utils: "src/lib/utils.ts",
			});

			expect(await pathExists(join(directory, "apps/web/app/layout.tsx"))).toBe(
				true,
			);
			expect(
				await pathExists(join(directory, "packages/ui/src/lib/utils.ts")),
			).toBe(true);
			expect(await pathExists(join(directory, "pnpm-workspace.yaml"))).toBe(
				true,
			);
			expect(Object.keys(lockfile.provenance.artifacts).length).toBeGreaterThan(
				0,
			);
		});
	});

	it("can replan from manifest installs without bootstrap heuristics", async () => {
		await withTempDir("planner-update", async (directory) => {
			const config: ForgeConfig = {
				packageManager: "pnpm",
				runtime: "Node.js",
				slug: "acme",
				style: "tailwind",
				web: "nextjs",
			};

			const createPlan = await Effect.runPromise(
				Effect.flatMap(Planner, (planner) =>
					planner.planCreate(directory, config, builtins),
				).pipe(Effect.provide(coreLayer)),
			);

			await Effect.runPromise(
				Apply.applyPlan(directory, {
					lockfile: createPlan.lockfile,
					manifest: createPlan.manifest,
					removals: createPlan.removals,
					writes: createPlan.writes.map((write) => ({
						content: write.content,
						path: write.path,
					})),
				}).pipe(Effect.provide(coreLayer)),
			);

			const manifest = await Effect.runPromise(
				State.readManifest(directory).pipe(Effect.provide(coreLayer)),
			);

			const updatePlan = await Effect.runPromise(
				Effect.flatMap(Planner, (planner) =>
					planner.planInstalled(
						directory,
						manifest.config as ForgeConfig,
						manifest.installs,
						builtins,
					),
				).pipe(Effect.provide(coreLayer)),
			);

			expect(
				updatePlan.writes.some((write) => write.path === "apps/web/forge.json"),
			).toBe(true);
			expect(
				JSON.parse(
					await readFile(join(directory, ".forge/manifest.json"), "utf-8"),
				),
			).toMatchObject({ config: { slug: "acme" } });
		});
	});
});
