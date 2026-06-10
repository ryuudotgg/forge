import { NodeContext } from "@effect/platform-node";
import { Cause, Effect, Exit, Layer, Option } from "effect";
import { describe, expect, it } from "vitest";
import {
	Apply,
	CoreLive,
	defineAddon,
	defineFramework,
	defineRegistry,
	defineTemplate,
	ensureAppModule,
	ensuredModuleTarget,
	ensurePackageModule,
	leafTextFile,
	type ModuleRecord,
	Planner,
	type PlannerError,
	type RenderBucket,
	surfaceText,
} from "../src/index";
import { readJson, withTempDir, writeJson } from "./harness";

interface TestConfig extends Record<string, unknown> {
	readonly auth?: boolean;
	readonly orm?: "a" | "b";
	readonly ui?: boolean;
	readonly web?: "nextjs";
}

const coreLayer = CoreLive.pipe(Layer.provideMerge(NodeContext.layer));

function testRegistry() {
	const framework = defineFramework({
		id: "nextjs",
		name: "Next.js",
		slots: ["layout"],
	});

	const template = defineTemplate<TestConfig>({
		id: "nextjs/base",
		framework: "nextjs",
		name: "Base",
		version: 1,
		category: "web",
		exclusive: true,
		when: (config) => config.web === "nextjs",
		contribute: () => [
			ensureAppModule("web", "apps/web", {
				framework: "nextjs",
				template: { id: "base", version: 1 },
				slots: { layout: "app/layout.tsx" },
			}),
			surfaceText(ensuredModuleTarget("web"), "layout", "base-layout"),
		],
	});

	const ui = defineAddon<TestConfig>({
		id: "ui",
		name: "UI Package",
		version: "0.1.0",
		category: "ui",
		exclusive: true,
		targetMode: "single",
		compatibility: {
			app: {
				frameworks: ["nextjs"],
				requiredSlots: ["layout"],
			},
		},
		when: (config) => config.ui === true,
		contribute: () => [
			ensurePackageModule("ui", "packages/ui", {
				packageType: "library",
				template: { id: "ui", version: 1 },
				capabilities: ["ui"],
				slots: { utils: "src/lib/utils.ts" },
			}),
			leafTextFile(
				ensuredModuleTarget("ui"),
				"src/lib/utils.ts",
				"export const ui = true;\n",
			),
		],
	});

	return defineRegistry({
		frameworks: [framework],
		templates: [template],
		addons: [ui],
	});
}

function moduleBucketId(bucket: RenderBucket) {
	return bucket.kind === "module" ? bucket.moduleId : undefined;
}

function alternativesRegistry() {
	const ormAddon = (id: "orm-a" | "orm-b", orm: "a" | "b") =>
		defineAddon<TestConfig>({
			id,
			name: `ORM ${orm.toUpperCase()}`,
			version: "0.1.0",
			category: "orm",
			exclusive: true,
			targetMode: "single",
			when: (config) => config.orm === orm,
			contribute: () => [
				ensurePackageModule("db", "packages/db", {
					packageType: "library",
					template: { id: "db", version: 1 },
					capabilities: ["db"],
					slots: {},
				}),
				leafTextFile(
					ensuredModuleTarget("db"),
					"src/client.ts",
					`export const orm = "${orm}";\n`,
				),
			],
		});

	const auth = defineAddon<TestConfig>({
		id: "auth",
		name: "Auth",
		version: "0.1.0",
		category: "auth",
		exclusive: true,
		dependencies: [
			{ id: "orm-a", type: "addon" },
			{ id: "orm-b", type: "addon" },
		],
		targetMode: "single",
		when: (config) => config.auth === true,
		contribute: () => [
			ensurePackageModule("auth", "packages/auth", {
				packageType: "library",
				template: { id: "auth", version: 1 },
				capabilities: ["auth"],
				slots: {},
			}),
			leafTextFile(
				ensuredModuleTarget("auth"),
				"src/index.ts",
				"export const auth = true;\n",
			),
		],
	});

	return defineRegistry({
		frameworks: [],
		templates: [],
		addons: [ormAddon("orm-a", "a"), ormAddon("orm-b", "b"), auth],
	});
}

describe("planner", () => {
	it("reconstructs legacy empty installs and retracts inactive ensured modules", async () => {
		await withTempDir("planner-legacy-installs", async (directory) => {
			const registry = testRegistry();
			const createConfig: TestConfig = { ui: true, web: "nextjs" };
			const updateConfig: TestConfig = { web: "nextjs" };

			const createPlan = await Effect.runPromise(
				Effect.flatMap(Planner, (planner) =>
					planner.planCreate(directory, createConfig, registry),
				).pipe(Effect.provide(coreLayer)),
			);

			await Effect.runPromise(
				Apply.applyPlan(directory, {
					lockfile: createPlan.lockfile,
					manifest: createPlan.manifest,
					removals: createPlan.removals,
					writes: createPlan.writes.map((write) => ({
						artifactId: write.artifactId,
						content: write.content,
						path: write.path,
					})),
				}).pipe(Effect.provide(coreLayer)),
			);

			const moduleRecords = (
				await readJson<{ modules: Record<string, ModuleRecord> }>(
					`${directory}/.forge/manifest.json`,
				)
			).modules;

			const uiModuleId = Object.entries(moduleRecords).find(([, record]) =>
				record.root?.includes("packages/ui"),
			)?.[0];

			expect(uiModuleId).toBeDefined();
			if (!uiModuleId) throw new Error("Missing UI Module");

			expect(
				createPlan.lockfile.artifacts[`module:${uiModuleId}:file:forge.json`],
			).toBeDefined();

			expect(
				createPlan.lockfile.artifacts[
					`module:${uiModuleId}:file:packages/ui/src/lib/utils.ts`
				],
			).toBeDefined();

			const updatePlan = await Effect.runPromise(
				Effect.flatMap(Planner, (planner) =>
					planner.planInstalled(directory, updateConfig, [], registry),
				).pipe(Effect.provide(coreLayer)),
			);

			expect(updatePlan.manifest.installs).toEqual([]);
			expect(updatePlan.manifest.modules[uiModuleId]).toBeUndefined();
			expect(updatePlan.removals).toEqual(
				expect.arrayContaining([
					"packages/ui/forge.json",
					"packages/ui/src/lib/utils.ts",
				]),
			);

			expect(
				updatePlan.writes.some(
					(write) => moduleBucketId(write.target) === uiModuleId,
				),
			).toBe(false);
		});
	});

	it("activates only the dependency alternative the config selects", async () => {
		await withTempDir("planner-dependency-alternatives", async (directory) => {
			const plan = await Effect.runPromise(
				Effect.flatMap(Planner, (planner) =>
					planner.planCreate(
						directory,
						{ auth: true, orm: "a" },
						alternativesRegistry(),
					),
				).pipe(Effect.provide(coreLayer)),
			);

			const client = plan.writes.find(
				(write) => write.path === "packages/db/src/client.ts",
			);

			expect(client?.content).toBe('export const orm = "a";\n');
			expect(
				plan.writes.some(
					(write) => write.path === "packages/auth/src/index.ts",
				),
			).toBe(true);
		});
	});

	it("fails when no dependency alternative is active", async () => {
		await withTempDir("planner-dependency-inactive", async (directory) => {
			await expect(
				Effect.runPromiseExit(
					Effect.flatMap(Planner, (planner) =>
						planner.planCreate(
							directory,
							{ auth: true },
							alternativesRegistry(),
						),
					).pipe(Effect.provide(coreLayer)),
				),
			).resolves.toSatisfy((exit) => {
				if (!Exit.isFailure(exit)) return false;

				const failure = Cause.failureOption(exit.cause);
				if (Option.isNone(failure)) return false;

				const error = failure.value as PlannerError;

				return (
					error._tag === "PlannerError" &&
					error.message === "Definition Dependency Inactive"
				);
			});
		});
	});

	it("fails when a single-target addon is installed into multiple modules", async () => {
		await withTempDir("planner-single-target", async (directory) => {
			await writeJson(`${directory}/apps/web/forge.json`, {
				id: "abcde",
				type: "app",
				framework: "nextjs",
				template: { id: "base", version: 1 },
				slots: { layout: "app/layout.tsx" },
			});

			await writeJson(`${directory}/apps/admin/forge.json`, {
				id: "fghij",
				type: "app",
				framework: "nextjs",
				template: { id: "base", version: 1 },
				slots: { layout: "app/layout.tsx" },
			});

			const registry = testRegistry();
			const config: TestConfig = { web: "nextjs" };

			await expect(
				Effect.runPromiseExit(
					Effect.flatMap(Planner, (planner) =>
						planner.planInstalled(
							directory,
							config,
							[
								{
									definitionId: "ui",
									targets: [
										{ kind: "module", moduleId: "abcde" },
										{ kind: "module", moduleId: "fghij" },
									],
								},
							],
							registry,
						),
					).pipe(Effect.provide(coreLayer)),
				),
			).resolves.toSatisfy((exit) => {
				if (!Exit.isFailure(exit)) return false;

				const failure = Cause.failureOption(exit.cause);
				if (Option.isNone(failure)) return false;

				const error = failure.value as PlannerError;

				return (
					error._tag === "PlannerError" &&
					error.message === "Multiple Targets Selected"
				);
			});
		});
	});
});
