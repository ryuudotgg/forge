import { rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { NodeContext } from "@effect/platform-node";
import { Cause, Effect, Exit, Layer, Option, Schema } from "effect";
import { describe, expect, it } from "vitest";
import {
	type AddonDefinition,
	Apply,
	CoreLive,
	type DefinitionRegistry,
	defineAddon,
	defineFramework,
	defineRegistry,
	defineTemplate,
	type EnsureModuleContribution,
	ensureAppModule,
	ensuredModuleTarget,
	ensurePackageModule,
	type InstallRecord,
	leafTextFile,
	type ModuleRecord,
	moduleCapabilities,
	PackageConfigSchema,
	Planner,
	PlannerError,
	type ProjectPlan,
	projectTarget,
	type RenderBucket,
	selectedModuleTarget,
	surfaceDependencies,
	surfaceText,
	templateModuleTarget,
} from "../src/index";
import { readJson, withTempDir, writeJson } from "./harness";

interface TestConfig extends Record<string, unknown> {
	readonly audit?: boolean;
	readonly auth?: boolean;
	readonly dual?: boolean;
	readonly kit?: boolean;
	readonly logs?: boolean;
	readonly metrics?: boolean;
	readonly orm?: "a" | "b";
	readonly packageManager?: string;
	readonly theme?: boolean;
	readonly ui?: boolean;
	readonly web?: "nextjs";
}

const coreLayer = CoreLive.pipe(Layer.provideMerge(NodeContext.layer));

const decodePackageConfig = Schema.decodeSync(
	Schema.parseJson(PackageConfigSchema),
);

const decodePackageJson = Schema.decodeSync(
	Schema.parseJson(
		Schema.Struct({
			dependencies: Schema.Record({ key: Schema.String, value: Schema.String }),
		}),
	),
);

function planCreateEffect(
	directory: string,
	config: TestConfig,
	registry: DefinitionRegistry<TestConfig>,
) {
	return Effect.flatMap(Planner, (planner) =>
		planner.planCreate(directory, config, registry),
	).pipe(Effect.provide(coreLayer));
}

function planInstalledEffect(
	directory: string,
	config: TestConfig,
	installs: ReadonlyArray<InstallRecord>,
	registry: DefinitionRegistry<TestConfig>,
) {
	return Effect.flatMap(Planner, (planner) =>
		planner.planInstalled(directory, config, installs, registry),
	).pipe(Effect.provide(coreLayer));
}

function applyPlanEffect(directory: string, plan: ProjectPlan) {
	return Apply.applyPlan(directory, {
		lockfile: plan.lockfile,
		manifest: plan.manifest,
		removals: plan.removals,
		writes: plan.writes.map((write) => ({
			artifactId: write.artifactId,
			content: write.content,
			path: write.path,
		})),
	}).pipe(Effect.provide(coreLayer));
}

function plannerFailure(exit: Exit.Exit<unknown, unknown>) {
	if (!Exit.isFailure(exit)) return undefined;

	const failure = Cause.failureOption(exit.cause);
	if (Option.isNone(failure)) return undefined;

	return failure.value instanceof PlannerError ? failure.value : undefined;
}

function moduleIdByRoot(
	modules: Readonly<Record<string, ModuleRecord>>,
	root: string,
) {
	return Object.entries(modules).find(
		([, record]) => record.root === root,
	)?.[0];
}

function testRegistry(
	extraAddons: ReadonlyArray<AddonDefinition<TestConfig>> = [],
) {
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
		addons: [ui, ...extraAddons],
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

function sharedModuleRegistry() {
	const telemetryAddon = (
		id: "logs" | "metrics",
		slot: "client" | "provider",
	) =>
		defineAddon<TestConfig>({
			id,
			name: id === "logs" ? "Logs" : "Metrics",
			version: "0.1.0",
			category: "tooling",
			exclusive: false,
			targetMode: "single",
			when: (config) => config[id] === true,
			contribute: () => [
				ensurePackageModule("telemetry", "packages/telemetry", {
					packageType: "library",
					template: { id: "telemetry", version: 1 },
					capabilities: [id],
					slots: { [slot]: `src/${slot}.ts` },
				}),
				leafTextFile(
					ensuredModuleTarget("telemetry"),
					`src/${id}.ts`,
					`export const ${id} = true;\n`,
				),
			],
		});

	return defineRegistry({
		frameworks: [],
		templates: [],
		addons: [
			telemetryAddon("logs", "client"),
			telemetryAddon("metrics", "provider"),
		],
	});
}

function ownershipRegistry() {
	const kitAddon = (id: "logs" | "audit", root: string) =>
		defineAddon<TestConfig>({
			id,
			name: id === "logs" ? "Logs" : "Audit",
			version: "0.1.0",
			category: "tooling",
			exclusive: false,
			targetMode: "single",
			when: (config) => config[id] === true,
			contribute: () => [
				ensurePackageModule(id, root, {
					packageType: "library",
					template: { id: "kit", version: 1 },
					capabilities: [id],
					slots: {},
				}),
				leafTextFile(
					ensuredModuleTarget(id),
					`src/${id}.ts`,
					`export const ${id} = true;\n`,
				),
			],
		});

	return defineRegistry({
		frameworks: [],
		templates: [],
		addons: [
			kitAddon("logs", "packages/telemetry"),
			kitAddon("audit", "packages/audit"),
		],
	});
}

function siblingRegistry() {
	return defineRegistry({
		frameworks: [],
		templates: [],
		addons: [
			defineAddon<TestConfig>({
				id: "dual",
				name: "Dual",
				version: "0.1.0",
				category: "tooling",
				exclusive: false,
				targetMode: "single",
				when: (config) => config.dual === true,
				contribute: () => [
					ensurePackageModule("one", "packages/one", {
						packageType: "library",
						template: { id: "kit", version: 1 },
						capabilities: [],
						slots: {},
					}),
					leafTextFile(
						ensuredModuleTarget("one"),
						"src/one.ts",
						"export const one = true;\n",
					),
					ensurePackageModule("two", "packages/two", {
						packageType: "library",
						template: { id: "kit", version: 1 },
						capabilities: [],
						slots: {},
					}),
					leafTextFile(
						ensuredModuleTarget("two"),
						"src/two.ts",
						"export const two = true;\n",
					),
				],
			}),
		],
	});
}

function ensureConflictRegistry(
	first: EnsureModuleContribution,
	second: EnsureModuleContribution,
) {
	const ensureAddon = (id: string, contribution: EnsureModuleContribution) =>
		defineAddon<TestConfig>({
			id,
			name: id,
			version: "0.1.0",
			category: "tooling",
			exclusive: false,
			targetMode: "single",
			when: () => true,
			contribute: () => [contribution],
		});

	return defineRegistry({
		frameworks: [],
		templates: [],
		addons: [ensureAddon("first", first), ensureAddon("second", second)],
	});
}

describe("planner", () => {
	it("reconstructs legacy empty installs and retracts inactive ensured modules", async () => {
		await withTempDir("planner-legacy-installs", async (directory) => {
			const registry = testRegistry();
			const createConfig: TestConfig = { ui: true, web: "nextjs" };
			const updateConfig: TestConfig = { web: "nextjs" };

			const createPlan = await Effect.runPromise(
				planCreateEffect(directory, createConfig, registry),
			);

			await Effect.runPromise(applyPlanEffect(directory, createPlan));

			const moduleRecords = (
				await readJson<{ modules: Record<string, ModuleRecord> }>(
					`${directory}/.forge/manifest.json`,
				)
			).modules;

			const uiModuleId = moduleIdByRoot(moduleRecords, "packages/ui");
			const webModuleId = moduleIdByRoot(moduleRecords, "apps/web");

			expect(uiModuleId).toBeDefined();
			expect(webModuleId).toBeDefined();
			if (!uiModuleId || !webModuleId) throw new Error("Missing Module Ids");

			expect(createPlan.manifest.installs).toEqual([
				{
					definitionId: "ui",
					targets: [{ kind: "module", moduleId: webModuleId }],
				},
			]);

			expect(
				createPlan.lockfile.artifacts[`module:${uiModuleId}:file:forge.json`],
			).toMatchObject({
				definitionIds: ["ui"],
				kind: "file",
				path: "packages/ui/forge.json",
			});

			expect(
				createPlan.lockfile.artifacts[
					`module:${uiModuleId}:file:packages/ui/src/lib/utils.ts`
				],
			).toMatchObject({
				definitionIds: ["ui"],
				kind: "file",
				path: "packages/ui/src/lib/utils.ts",
			});

			const updatePlan = await Effect.runPromise(
				planInstalledEffect(directory, updateConfig, [], registry),
			);

			expect(updatePlan.manifest.installs).toEqual([]);
			expect(updatePlan.manifest.modules[uiModuleId]).toBeUndefined();
			expect(updatePlan.manifest.modules[webModuleId]).toBeDefined();
			expect([...updatePlan.removals].sort()).toEqual([
				"packages/ui/forge.json",
				"packages/ui/src/lib/utils.ts",
			]);

			expect(
				updatePlan.writes.some(
					(write) => moduleBucketId(write.target) === uiModuleId,
				),
			).toBe(false);
			expect(
				updatePlan.writes.some((write) => write.path === "apps/web/forge.json"),
			).toBe(true);
		});
	});

	it("activates only the dependency alternative the config selects", async () => {
		await withTempDir("planner-dependency-alternatives", async (directory) => {
			const plan = await Effect.runPromise(
				planCreateEffect(
					directory,
					{ auth: true, orm: "a" },
					alternativesRegistry(),
				),
			);

			const client = plan.writes.find(
				(write) => write.path === "packages/db/src/client.ts",
			);

			expect(client?.content).toBe('export const orm = "a";\n');

			const authFile = plan.writes.find(
				(write) => write.path === "packages/auth/src/index.ts",
			);

			expect(authFile?.content).toBe("export const auth = true;\n");
		});
	});

	it("fails when no dependency alternative is active", async () => {
		await withTempDir("planner-dependency-inactive", async (directory) => {
			const exit = await Effect.runPromiseExit(
				planCreateEffect(directory, { auth: true }, alternativesRegistry()),
			);

			const error = plannerFailure(exit);

			expect(error?.message).toBe("Definition Dependency Inactive");
			expect(error?.path).toBe("auth");
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

			const exit = await Effect.runPromiseExit(
				planInstalledEffect(
					directory,
					{ web: "nextjs" },
					[
						{
							definitionId: "ui",
							targets: [
								{ kind: "module", moduleId: "abcde" },
								{ kind: "module", moduleId: "fghij" },
							],
						},
					],
					testRegistry(),
				),
			);

			const error = plannerFailure(exit);

			expect(error?.message).toBe("Multiple Targets Selected");
			expect(error?.path).toBe("ui");
		});
	});

	it("resolves dependency alternatives on the installed path", async () => {
		await withTempDir("planner-installed-alternatives", async (directory) => {
			const registry = alternativesRegistry();
			const config: TestConfig = { auth: true, orm: "a" };

			const createPlan = await Effect.runPromise(
				planCreateEffect(directory, config, registry),
			);

			await Effect.runPromise(applyPlanEffect(directory, createPlan));

			const installedPlan = await Effect.runPromise(
				planInstalledEffect(
					directory,
					config,
					[
						{ definitionId: "auth", targets: [{ kind: "project" }] },
						{ definitionId: "orm-a", targets: [{ kind: "project" }] },
					],
					registry,
				),
			);

			const client = installedPlan.writes.find(
				(write) => write.path === "packages/db/src/client.ts",
			);

			expect(client?.content).toBe('export const orm = "a";\n');

			const authFile = installedPlan.writes.find(
				(write) => write.path === "packages/auth/src/index.ts",
			);

			expect(authFile?.content).toBe("export const auth = true;\n");

			expect(Object.keys(installedPlan.manifest.modules).sort()).toEqual(
				Object.keys(createPlan.manifest.modules).sort(),
			);
			expect(installedPlan.removals).toEqual([]);
		});
	});

	it("fails the installed path when no dependency alternative is active", async () => {
		await withTempDir("planner-installed-inactive", async (directory) => {
			const exit = await Effect.runPromiseExit(
				planInstalledEffect(
					directory,
					{ auth: true },
					[{ definitionId: "auth", targets: [{ kind: "project" }] }],
					alternativesRegistry(),
				),
			);

			const error = plannerFailure(exit);

			expect(error?.message).toBe("Definition Dependency Inactive");
			expect(error?.path).toBe("auth");
		});
	});

	// runAdd guards exclusivity before planning; this pins the planner's backstop.
	it("fails with the leaf file backstop when conflicting addons are installed together", async () => {
		await withTempDir("planner-leaf-conflict", async (directory) => {
			const exit = await Effect.runPromiseExit(
				planInstalledEffect(
					directory,
					{ orm: "a" },
					[
						{ definitionId: "orm-a", targets: [{ kind: "project" }] },
						{ definitionId: "orm-b", targets: [{ kind: "project" }] },
					],
					alternativesRegistry(),
				),
			);

			const error = plannerFailure(exit);

			expect(error?.message).toBe("Leaf File Conflict");
			expect(error?.path).toBe("leaf-files");
		});
	});

	it("merges shared ensured modules and keeps them while a definition remains", async () => {
		await withTempDir("planner-shared-module", async (directory) => {
			const registry = sharedModuleRegistry();

			const createPlan = await Effect.runPromise(
				planCreateEffect(directory, { logs: true, metrics: true }, registry),
			);

			const telemetryId = moduleIdByRoot(
				createPlan.manifest.modules,
				"packages/telemetry",
			);

			expect(telemetryId).toBeDefined();
			if (!telemetryId) throw new Error("Missing Telemetry Module");

			expect(createPlan.manifest.modules[telemetryId]?.definitionIds).toEqual([
				"logs",
				"metrics",
			]);

			const createForge = createPlan.writes.find(
				(write) => write.path === "packages/telemetry/forge.json",
			);

			expect(createForge).toBeDefined();
			if (!createForge) throw new Error("Missing Telemetry Config Write");

			const createConfig = decodePackageConfig(createForge.content);

			expect([...createConfig.capabilities].sort()).toEqual([
				"logs",
				"metrics",
			]);
			expect(createConfig.slots).toEqual({
				client: "src/client.ts",
				provider: "src/provider.ts",
			});

			await Effect.runPromise(applyPlanEffect(directory, createPlan));

			const removalPlan = await Effect.runPromise(
				planInstalledEffect(
					directory,
					{ logs: true },
					[{ definitionId: "logs", targets: [{ kind: "project" }] }],
					registry,
				),
			);

			expect(removalPlan.manifest.modules[telemetryId]).toBeDefined();
			expect(removalPlan.manifest.modules[telemetryId]?.definitionIds).toEqual([
				"logs",
			]);
			expect(removalPlan.removals).toEqual([
				"packages/telemetry/src/metrics.ts",
			]);
			expect(
				removalPlan.writes.some(
					(write) => write.path === "packages/telemetry/src/logs.ts",
				),
			).toBe(true);

			const survivorForge = removalPlan.writes.find(
				(write) => write.path === "packages/telemetry/forge.json",
			);

			expect(survivorForge).toBeDefined();
			if (!survivorForge) throw new Error("Missing Survivor Config Write");

			const survivorConfig = decodePackageConfig(survivorForge.content);

			expect([...survivorConfig.capabilities]).toEqual(["logs"]);
			expect(survivorConfig.slots).toEqual({ client: "src/client.ts" });
		});
	});

	it("adopts a renamed module root instead of recreating it", async () => {
		await withTempDir("planner-renamed-root", async (directory) => {
			const registry = sharedModuleRegistry();
			const installs: InstallRecord[] = [
				{ definitionId: "logs", targets: [{ kind: "project" }] },
			];

			const createPlan = await Effect.runPromise(
				planCreateEffect(directory, { logs: true }, registry),
			);

			await Effect.runPromise(applyPlanEffect(directory, createPlan));

			const telemetryId = moduleIdByRoot(
				createPlan.manifest.modules,
				"packages/telemetry",
			);

			expect(telemetryId).toBeDefined();
			if (!telemetryId) throw new Error("Missing Telemetry Module");

			await rename(
				join(directory, "packages/telemetry"),
				join(directory, "packages/observability"),
			);

			const updatePlan = await Effect.runPromise(
				planInstalledEffect(directory, { logs: true }, installs, registry),
			);

			expect(Object.keys(updatePlan.manifest.modules)).toEqual([telemetryId]);
			expect(updatePlan.manifest.modules[telemetryId]?.root).toBe(
				"packages/observability",
			);
			expect(
				updatePlan.writes.some(
					(write) => write.path === "packages/observability/forge.json",
				),
			).toBe(true);
			expect(
				updatePlan.writes.some(
					(write) => write.path === "packages/observability/src/logs.ts",
				),
			).toBe(true);
			expect(
				updatePlan.writes.some((write) =>
					write.path.startsWith("packages/telemetry/"),
				),
			).toBe(false);
		});
	});

	it("adopts a renamed app module root", async () => {
		await withTempDir("planner-renamed-app", async (directory) => {
			const registry = testRegistry();

			const createPlan = await Effect.runPromise(
				planCreateEffect(directory, { web: "nextjs" }, registry),
			);

			await Effect.runPromise(applyPlanEffect(directory, createPlan));

			const webId = moduleIdByRoot(createPlan.manifest.modules, "apps/web");

			expect(webId).toBeDefined();
			if (!webId) throw new Error("Missing Web Module");

			await rename(join(directory, "apps/web"), join(directory, "apps/site"));

			const updatePlan = await Effect.runPromise(
				planInstalledEffect(directory, { web: "nextjs" }, [], registry),
			);

			expect(Object.keys(updatePlan.manifest.modules)).toEqual([webId]);
			expect(updatePlan.manifest.modules[webId]?.root).toBe("apps/site");
			expect(
				updatePlan.writes.some(
					(write) => write.path === "apps/site/app/layout.tsx",
				),
			).toBe(true);
			expect(
				updatePlan.writes.some((write) => write.path.startsWith("apps/web/")),
			).toBe(false);
		});
	});

	it("preserves a moved slot path through replanning", async () => {
		await withTempDir("planner-moved-slot", async (directory) => {
			const registry = sharedModuleRegistry();
			const installs: InstallRecord[] = [
				{ definitionId: "logs", targets: [{ kind: "project" }] },
			];

			const createPlan = await Effect.runPromise(
				planCreateEffect(directory, { logs: true }, registry),
			);

			await Effect.runPromise(applyPlanEffect(directory, createPlan));

			const configPath = join(directory, "packages/telemetry/forge.json");
			const onDisk = await readJson<{ slots: Record<string, string> }>(
				configPath,
			);

			await writeJson(configPath, {
				...onDisk,
				slots: { ...onDisk.slots, client: "src/moved/client.ts" },
			});

			const updatePlan = await Effect.runPromise(
				planInstalledEffect(directory, { logs: true }, installs, registry),
			);

			const forgeWrite = updatePlan.writes.find(
				(write) => write.path === "packages/telemetry/forge.json",
			);

			expect(forgeWrite).toBeDefined();
			if (!forgeWrite) throw new Error("Missing Telemetry Config Write");

			expect(decodePackageConfig(forgeWrite.content).slots).toEqual({
				client: "src/moved/client.ts",
			});
		});
	});

	it("keeps moved slot paths for every ensure of a shared module", async () => {
		await withTempDir("planner-shared-moved-slot", async (directory) => {
			const registry = sharedModuleRegistry();
			const installs: InstallRecord[] = [
				{ definitionId: "logs", targets: [{ kind: "project" }] },
				{ definitionId: "metrics", targets: [{ kind: "project" }] },
			];

			const createPlan = await Effect.runPromise(
				planCreateEffect(directory, { logs: true, metrics: true }, registry),
			);

			await Effect.runPromise(applyPlanEffect(directory, createPlan));

			const configPath = join(directory, "packages/telemetry/forge.json");
			const onDisk = await readJson<{ slots: Record<string, string> }>(
				configPath,
			);

			await writeJson(configPath, {
				...onDisk,
				slots: { ...onDisk.slots, provider: "src/custom/provider.ts" },
			});

			const updatePlan = await Effect.runPromise(
				planInstalledEffect(
					directory,
					{ logs: true, metrics: true },
					installs,
					registry,
				),
			);

			const forgeWrite = updatePlan.writes.find(
				(write) => write.path === "packages/telemetry/forge.json",
			);

			expect(forgeWrite).toBeDefined();
			if (!forgeWrite) throw new Error("Missing Telemetry Config Write");

			expect(decodePackageConfig(forgeWrite.content).slots).toEqual({
				client: "src/client.ts",
				provider: "src/custom/provider.ts",
			});
		});
	});

	it("leaves renamed modules owned by other definitions alone", async () => {
		await withTempDir("planner-adoption-ownership", async (directory) => {
			const registry = ownershipRegistry();

			const createPlan = await Effect.runPromise(
				planCreateEffect(directory, { audit: true }, registry),
			);

			await Effect.runPromise(applyPlanEffect(directory, createPlan));

			const auditId = moduleIdByRoot(
				createPlan.manifest.modules,
				"packages/audit",
			);

			expect(auditId).toBeDefined();
			if (!auditId) throw new Error("Missing Audit Module");

			await rename(
				join(directory, "packages/audit"),
				join(directory, "packages/audit-renamed"),
			);

			const updatePlan = await Effect.runPromise(
				planInstalledEffect(
					directory,
					{ audit: true, logs: true },
					[
						{ definitionId: "logs", targets: [{ kind: "project" }] },
						{ definitionId: "audit", targets: [{ kind: "project" }] },
					],
					registry,
				),
			);

			const roots = Object.values(updatePlan.manifest.modules)
				.map((record) => record.root)
				.sort();

			expect(roots).toEqual(["packages/audit-renamed", "packages/telemetry"]);
			expect(updatePlan.manifest.modules[auditId]?.root).toBe(
				"packages/audit-renamed",
			);
			expect(updatePlan.manifest.modules[auditId]?.definitionIds).toEqual([
				"audit",
			]);
		});
	});

	it("heals a deleted sibling module without stealing the survivor", async () => {
		await withTempDir("planner-sibling-heal", async (directory) => {
			const registry = siblingRegistry();
			const installs: InstallRecord[] = [
				{ definitionId: "dual", targets: [{ kind: "project" }] },
			];

			const createPlan = await Effect.runPromise(
				planCreateEffect(directory, { dual: true }, registry),
			);

			await Effect.runPromise(applyPlanEffect(directory, createPlan));

			await rm(join(directory, "packages/one"), {
				force: true,
				recursive: true,
			});

			const updatePlan = await Effect.runPromise(
				planInstalledEffect(directory, { dual: true }, installs, registry),
			);

			const roots = Object.values(updatePlan.manifest.modules)
				.map((record) => record.root)
				.sort();

			expect(roots).toEqual(["packages/one", "packages/two"]);
			expect(
				updatePlan.writes.some(
					(write) => write.path === "packages/one/src/one.ts",
				),
			).toBe(true);
		});
	});

	it("falls back to fresh modules when adoption is ambiguous", async () => {
		await withTempDir("planner-ambiguous-adoption", async (directory) => {
			const registry = siblingRegistry();
			const installs: InstallRecord[] = [
				{ definitionId: "dual", targets: [{ kind: "project" }] },
			];

			const createPlan = await Effect.runPromise(
				planCreateEffect(directory, { dual: true }, registry),
			);

			await Effect.runPromise(applyPlanEffect(directory, createPlan));

			await rename(
				join(directory, "packages/one"),
				join(directory, "packages/one-moved"),
			);
			await rename(
				join(directory, "packages/two"),
				join(directory, "packages/two-moved"),
			);

			const updatePlan = await Effect.runPromise(
				planInstalledEffect(directory, { dual: true }, installs, registry),
			);

			const roots = Object.values(updatePlan.manifest.modules)
				.map((record) => record.root)
				.sort();

			expect(roots).toEqual([
				"packages/one",
				"packages/one-moved",
				"packages/two",
				"packages/two-moved",
			]);
		});
	});

	it("fails when ensured package modules disagree on template", async () => {
		await withTempDir("planner-package-conflict", async (directory) => {
			const registry = ensureConflictRegistry(
				ensurePackageModule("telemetry", "packages/telemetry", {
					packageType: "library",
					template: { id: "telemetry", version: 1 },
					capabilities: [],
					slots: {},
				}),
				ensurePackageModule("telemetry", "packages/telemetry", {
					packageType: "library",
					template: { id: "telemetry", version: 2 },
					capabilities: [],
					slots: {},
				}),
			);

			const exit = await Effect.runPromiseExit(
				planCreateEffect(directory, {}, registry),
			);

			const error = plannerFailure(exit);

			expect(error?.message).toBe("Ensured Package Module Conflict");
			expect(error?.path).toBe("packages/telemetry");
		});
	});

	it("fails when ensured app modules disagree on template", async () => {
		await withTempDir("planner-app-conflict", async (directory) => {
			const registry = ensureConflictRegistry(
				ensureAppModule("web", "apps/web", {
					framework: "nextjs",
					template: { id: "base", version: 1 },
					slots: {},
				}),
				ensureAppModule("web", "apps/web", {
					framework: "nextjs",
					template: { id: "base", version: 2 },
					slots: {},
				}),
			);

			const exit = await Effect.runPromiseExit(
				planCreateEffect(directory, {}, registry),
			);

			const error = plannerFailure(exit);

			expect(error?.message).toBe("Ensured App Module Conflict");
			expect(error?.path).toBe("apps/web");
		});
	});

	it("fails when ensured module types disagree at one root", async () => {
		await withTempDir("planner-type-conflict", async (directory) => {
			const registry = ensureConflictRegistry(
				ensureAppModule("web", "apps/web", {
					framework: "nextjs",
					template: { id: "base", version: 1 },
					slots: {},
				}),
				ensurePackageModule("web", "apps/web", {
					packageType: "library",
					template: { id: "base", version: 1 },
					capabilities: [],
					slots: {},
				}),
			);

			const exit = await Effect.runPromiseExit(
				planCreateEffect(directory, {}, registry),
			);

			const error = plannerFailure(exit);

			expect(error?.message).toBe("Ensured Module Type Conflict");
			expect(error?.path).toBe("apps/web");
		});
	});

	it("fails when an install record references a missing definition", async () => {
		await withTempDir("planner-definition-missing", async (directory) => {
			const exit = await Effect.runPromiseExit(
				planInstalledEffect(
					directory,
					{ web: "nextjs" },
					[{ definitionId: "ghost", targets: [] }],
					testRegistry(),
				),
			);

			const error = plannerFailure(exit);

			expect(error?.message).toBe("Definition Missing");
			expect(error?.path).toBe("ghost");
		});
	});

	it("routes contributions across project, selected, and template targets", async () => {
		await withTempDir("planner-target-arms", async (directory) => {
			const theme = defineAddon<TestConfig>({
				id: "theme",
				name: "Theme",
				version: "0.1.0",
				category: "style",
				exclusive: false,
				targetMode: "single",
				compatibility: {
					app: {
						frameworks: ["nextjs"],
						requiredSlots: ["layout"],
					},
				},
				when: (config) => config.theme === true,
				contribute: () => [
					leafTextFile(
						projectTarget(),
						"theme.config.ts",
						"export const theme = true;\n",
					),
					surfaceText(selectedModuleTarget(), "layout", "themed-layout", {
						priority: 1,
					}),
					moduleCapabilities(templateModuleTarget("ui", 1), ["theme"]),
				],
			});

			const plan = await Effect.runPromise(
				planCreateEffect(
					directory,
					{ theme: true, ui: true, web: "nextjs" },
					testRegistry([theme]),
				),
			);

			const webModuleId = moduleIdByRoot(plan.manifest.modules, "apps/web");
			const uiModuleId = moduleIdByRoot(plan.manifest.modules, "packages/ui");

			expect(webModuleId).toBeDefined();
			expect(uiModuleId).toBeDefined();
			if (!webModuleId || !uiModuleId) throw new Error("Missing Module Ids");

			expect(plan.manifest.installs).toEqual([
				{
					definitionId: "ui",
					targets: [{ kind: "module", moduleId: webModuleId }],
				},
				{
					definitionId: "theme",
					targets: [{ kind: "module", moduleId: webModuleId }],
				},
			]);

			const layout = plan.writes.find(
				(write) => write.path === "apps/web/app/layout.tsx",
			);

			expect(layout).toMatchObject({
				content: "themed-layout",
				definitionIds: ["nextjs/base", "theme"],
				target: { kind: "module", moduleId: webModuleId },
			});

			const themeConfig = plan.writes.find(
				(write) => write.path === "theme.config.ts",
			);

			expect(themeConfig).toMatchObject({
				artifactId: "project:file:theme.config.ts",
				content: "export const theme = true;\n",
				target: { kind: "project" },
			});

			const uiForge = plan.writes.find(
				(write) => write.path === "packages/ui/forge.json",
			);

			expect(uiForge).toBeDefined();
			if (!uiForge) throw new Error("Missing UI Config Write");

			expect(decodePackageConfig(uiForge.content).capabilities).toEqual([
				"ui",
				"theme",
			]);

			expect(
				plan.lockfile.artifacts["project:file:theme.config.ts"],
			).toMatchObject({
				definitionIds: ["theme"],
				kind: "file",
				path: "theme.config.ts",
			});
		});
	});

	it("fails when a selected module target resolves no modules", async () => {
		await withTempDir("planner-selected-target-missing", async (directory) => {
			const banner = defineAddon<TestConfig>({
				id: "banner",
				name: "Banner",
				version: "0.1.0",
				category: "ui",
				exclusive: false,
				targetMode: "single",
				when: () => true,
				contribute: () => [
					surfaceText(selectedModuleTarget(), "layout", "banner-layout"),
				],
			});

			const registry = defineRegistry({
				frameworks: [],
				templates: [],
				addons: [banner],
			});

			const exit = await Effect.runPromiseExit(
				planInstalledEffect(
					directory,
					{},
					[{ definitionId: "banner", targets: [] }],
					registry,
				),
			);

			const error = plannerFailure(exit);

			expect(error?.message).toBe("Selected Target Missing");
			expect(error?.path).toBe("banner");
		});
	});

	it("fails when a template module target matches no modules", async () => {
		await withTempDir("planner-template-target-missing", async (directory) => {
			const decor = defineAddon<TestConfig>({
				id: "decor",
				name: "Decor",
				version: "0.1.0",
				category: "ui",
				exclusive: false,
				targetMode: "single",
				when: () => true,
				contribute: () => [
					surfaceText(templateModuleTarget("missing", 1), "layout", "decor"),
				],
			});

			const registry = defineRegistry({
				frameworks: [],
				templates: [],
				addons: [decor],
			});

			const exit = await Effect.runPromiseExit(
				planCreateEffect(directory, {}, registry),
			);

			const error = plannerFailure(exit);

			expect(error?.message).toBe("Target Module Missing");
			expect(error?.path).toBe("decor");
		});
	});

	it("formats workspace dependencies for the configured package manager", async () => {
		await withTempDir("planner-npm-dependencies", async (directory) => {
			const kit = defineAddon<TestConfig>({
				id: "kit",
				name: "Kit",
				version: "0.1.0",
				category: "tooling",
				exclusive: false,
				targetMode: "single",
				when: (config) => config.kit === true,
				contribute: () => [
					ensurePackageModule("kit", "packages/kit", {
						packageType: "library",
						template: { id: "kit", version: 1 },
						capabilities: [],
						slots: {},
					}),
					surfaceDependencies(ensuredModuleTarget("kit"), "packageJson", [
						{ name: "@acme/ui", version: "workspace:*", type: "dependencies" },
					]),
				],
			});

			const registry = defineRegistry({
				frameworks: [],
				templates: [],
				addons: [kit],
			});

			const readDependency = (plan: ProjectPlan) => {
				const packageJson = plan.writes.find(
					(write) => write.path === "packages/kit/package.json",
				);

				expect(packageJson).toBeDefined();
				if (!packageJson) throw new Error("Missing Package Json Write");

				return decodePackageJson(packageJson.content).dependencies["@acme/ui"];
			};

			const npmPlan = await Effect.runPromise(
				planCreateEffect(
					directory,
					{ kit: true, packageManager: "npm" },
					registry,
				),
			);

			const pnpmPlan = await Effect.runPromise(
				planCreateEffect(
					directory,
					{ kit: true, packageManager: "pnpm" },
					registry,
				),
			);

			expect(readDependency(npmPlan)).toBe("*");
			expect(readDependency(pnpmPlan)).toBe("workspace:*");
		});
	});
});
