import { access, mkdir, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { log } from "@clack/prompts";
import { NodeServices } from "@effect/platform-node";
import { Apply, CliVersion, CommandProbe, CoreLive, State } from "@ryuugg/core";
import * as generators from "@ryuugg/generators";
import { type ForgeConfig, loadDefinitionRegistry } from "@ryuugg/generators";
import { Effect, Layer, ManagedRuntime } from "effect";
import { describe, expect, it, vi } from "vitest";
import {
	type AdoptedModuleVersions,
	AdoptionDetector,
	AdoptionFileReadError,
	adoptedWebConfig,
	type ConfirmedModule,
	type ModuleKind,
	type ModuleMappingProposal,
	primaryWebRoot,
	resolveWebAppAdoption,
	webRoots,
} from "../src/commands/adoption";
import {
	adoptionConflictGuidance,
	adoptionOutro,
	adoptionReport,
	buildAdoptionPlan,
	contentHashError,
	defaultIdentity,
	readInitConfigFile,
	runInit,
} from "../src/commands/init";
import { cliLayer, withCliRuntime } from "../src/runtime";
import { firstPartyAddonIds } from "../src/steps/platforms/web-apps";
import {
	failingAddonRegistry,
	planningFailures,
	withTempDir,
	writeJson,
	writeText,
} from "./lifecycle-fixtures";

const coreLayer = CoreLive.pipe(
	Layer.provide(Layer.succeed(CliVersion, { version: "test-cli-version" })),
	Layer.provideMerge(NodeServices.layer),
);

function buildAdoptionPlanForTest(
	directory: string,
	inputConfig: ForgeConfig,
	confirmed: ReadonlyArray<ConfirmedModule>,
	adoptedVersions: ReadonlyArray<AdoptedModuleVersions>,
	proposals: ReadonlyArray<ModuleMappingProposal> = [],
) {
	const versions = new Map([
		["node", "22.11.0"],
		["pnpm", "10.12.1"],
	]);

	const plan = Effect.gen(function* () {
		const detection = yield* AdoptionDetector.detect(directory);
		const resolved = yield* resolveWebAppAdoption({
			addonIds: firstPartyAddonIds(),
			confirmed,
			observations: detection.webApps,
			primaryRoot: primaryWebRoot(webRoots(confirmed)),
			requested: inputConfig,
		});

		return yield* buildAdoptionPlan(
			directory,
			{
				commandPins: detection.commandPins,
				config: { ...inputConfig, ...adoptedWebConfig(resolved, inputConfig) },
				prototypeRoots: resolved.prototypeRoots,
			},
			confirmed,
			adoptedVersions,
			proposals,
		);
	});

	return plan.pipe(
		Effect.provideService(CommandProbe, {
			readVersion: (command: string) =>
				Effect.sync(() => {
					const version = versions.get(command);
					if (version === undefined)
						throw new Error(`Unexpected Command Probe: ${command}`);

					return version;
				}),
		}),
		Effect.provide(cliLayer),
	);
}

const config: ForgeConfig = {
	addons: [],
	backend: "self",
	catalogs: "flat",
	database: "sqlite",
	linter: "biome",
	name: "Acme",
	orm: "drizzle",
	packageManager: "pnpm",
	path: ".",
	platforms: ["web"],
	runtime: "Node.js",
	slug: "acme",
	web: "nextjs",
};

async function fixture(directory: string) {
	await writeJson(join(directory, "package.json"), {
		name: "acme",
		private: true,
		scripts: { user: "keep-me" },
	});

	await writeText(
		join(directory, "pnpm-workspace.yaml"),
		"packages:\n  - 'apps/*'\n  - 'packages/*'\n  - 'sites/*'\n",
	);

	await writeJson(join(directory, "apps/web/package.json"), {
		dependencies: { next: "^16.0.0", react: "^19.0.0" },
		name: "@acme/web",
		private: true,
	});

	await writeJson(join(directory, "packages/db/package.json"), {
		dependencies: { "drizzle-orm": "1.0.0-rc.4" },
		name: "@acme/db",
		private: true,
	});
}

async function snapshot(directory: string) {
	const files = await readdir(directory, {
		recursive: true,
		withFileTypes: true,
	});

	const contents: Record<string, string> = {};
	for (const entry of files.filter((file) => file.isFile())) {
		const path = join(entry.parentPath, entry.name);
		contents[path] = await readFile(path, "utf-8");
	}

	return contents;
}

async function exists(path: string) {
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
}

describe("init command", () => {
	it.each(planningFailures)(
		"prints planning failure: $message",
		async ({ failure }) => {
			const loaded = failingAddonRegistry(failure);
			const registry = vi
				.spyOn(generators, "loadDefinitionRegistry")
				.mockReturnValue(loaded);

			const logError = vi.spyOn(log, "error").mockImplementation(() => {});
			const exit = vi.spyOn(process, "exit").mockImplementation((code) => {
				throw new Error(`exit:${code ?? 0}`);
			});

			const expected =
				"_tag" in failure && failure._tag === "Refusal"
					? failure.message
					: "We couldn't plan this adoption. Definition Failed: boom";

			try {
				await withTempDir("init-refusal", async (directory) => {
					await fixture(directory);
					const configPath = join(directory, "forge.init.json");
					await writeJson(configPath, {
						...config,
						modules: [{ kind: "web-app", root: "apps/web" }],
					});

					await expect(
						runInit({ config: configPath }, directory),
					).rejects.toThrow("exit:1");
				});

				expect(logError).toHaveBeenNthCalledWith(1, expected);
				expect(exit).toHaveBeenCalledWith(1);
			} finally {
				registry.mockRestore();
				logError.mockRestore();
				exit.mockRestore();
			}
		},
	);

	it("rejects unexpected command probes", async () => {
		await withTempDir("init-unexpected-probe", async (directory) => {
			await fixture(directory);

			await expect(
				Effect.runPromise(
					buildAdoptionPlanForTest(
						directory,
						{ ...config, packageManager: "npm" },
						[
							{ kind: "web-app", root: "apps/web" },
							{ kind: "db", root: "packages/db" },
						],
						[],
					),
				),
			).rejects.toThrow("Unexpected Command Probe: npm");
		});
	});

	it("guides the next adoption step and conflict resolution", () => {
		expect(adoptionOutro(false)).toBe(
			"This project is now managed by Forge. Run forge update to reconcile it.",
		);

		expect(adoptionConflictGuidance()).toBe(
			"If conflicts surface, we can guide you through them interactively, or you can run forge update with --keep-user or --accept-forge.",
		);

		expect(adoptionOutro(true)).toBe(
			"This project is managed by Forge and reconciled.",
		);
	});

	it("reads config fields and module mappings from the same JSON file", async () => {
		await withTempDir("init-config", async (directory) => {
			const path = join(directory, "forge.init.json");
			await writeJson(path, {
				...config,
				modules: [{ kind: "web-app", root: "apps/web" }],
			});

			expect(readInitConfigFile(path)).toEqual({
				config,
				modules: [{ kind: "web-app", root: "apps/web" }],
			});
		});
	});

	it("reports unreadable and invalid config files", async () => {
		await withTempDir("init-config-errors", async (directory) => {
			const exit = vi.spyOn(process, "exit").mockImplementation(() => {
				throw new Error("exit:1");
			});

			try {
				expect(() =>
					readInitConfigFile(join(directory, "missing.json")),
				).toThrow("exit:1");

				const invalid = join(directory, "invalid.json");
				await writeJson(invalid, {
					modules: [{ kind: "unknown", root: "apps/web" }],
				});

				expect(() => readInitConfigFile(invalid)).toThrow("exit:1");
			} finally {
				exit.mockRestore();
			}
		});
	});

	it("preserves v3 init-config field diagnostics", async () => {
		await withTempDir("init-config-diagnostics", async (directory) => {
			const exit = vi.spyOn(process, "exit").mockImplementation(() => {
				throw new Error("exit:1");
			});

			const logError = vi.spyOn(log, "error").mockImplementation(() => {});
			try {
				const invalid = join(directory, "invalid.json");
				await writeJson(invalid, { modules: "bad" });

				expect(() => readInitConfigFile(invalid)).toThrow("exit:1");
				expect(logError).toHaveBeenLastCalledWith(
					'Your config file is invalid.\n  modules: Expected ReadonlyArray<{ readonly kind: "web-app" | "backend-app" | "db" | "auth" | "trpc" | "orpc" | "ui"; readonly root: string }>, actual "bad"',
				);

				const missing = join(directory, "missing-modules.json");
				await writeJson(missing, {});

				expect(() => readInitConfigFile(missing)).toThrow("exit:1");
				expect(logError).toHaveBeenLastCalledWith(
					"Your config file is invalid.\n  modules: is missing",
				);
			} finally {
				logError.mockRestore();
				exit.mockRestore();
			}
		});
	});

	it("keeps package module kinds congruent with the first-party registry", () => {
		const loaded = loadDefinitionRegistry();
		const packageKinds: ReadonlyArray<
			Exclude<ModuleKind, "backend-app" | "web-app">
		> = ["db", "auth", "trpc", "orpc", "ui"];

		const packageAddons = {
			auth: "better-auth",
			db: "drizzle",
			orpc: "orpc",
			trpc: "trpc",
			ui: "ui",
		} satisfies Readonly<
			Record<Exclude<ModuleKind, "backend-app" | "web-app">, string>
		>;

		for (const kind of packageKinds) {
			const addon = loaded.registry.addons.find(
				(entry) => entry.id === packageAddons[kind],
			);

			if (addon === undefined) throw new Error(`Missing Addon: ${kind}`);

			const result = addon.contribute({
				commandVersions: {},
				config:
					kind === "auth"
						? { ...config, authentication: "better-auth" }
						: config,
				frameworks: loaded.registry.frameworks,
			});

			if (result instanceof Promise || Effect.isEffect(result))
				throw new Error(`Synchronous Contributions Expected: ${kind}`);

			expect(
				result.some(
					(contribution) =>
						contribution._tag === "EnsureModuleContribution" &&
						contribution.module.type === "package" &&
						contribution.module.template.id === kind,
				),
				kind,
			).toBe(true);
		}

		expect(contentHashError("apps/web/package.json").message).toBe(
			"Content Hash Failed: apps/web/package.json",
		);
	});

	it("derives yes-mode identity from the root package name", () => {
		expect(defaultIdentity("/workspace/fallback", "Acme Platform")).toEqual({
			name: "Acme Platform",
			slug: "acme-platform",
		});

		expect(defaultIdentity("/workspace/Fallback Project")).toEqual({
			name: "fallback-projec",
			slug: "fallback-projec",
		});
	});

	it("formats an aligned adoption report from the planned config", () => {
		const plannedConfig = {
			...config,
			webApps: [
				{ name: "admin", framework: "react-router", port: 3003, client: true },
			],
		};

		const report = adoptionReport([{ kind: "web-app", root: "apps/web" }], {
			applyPlan: {
				lockfile: { artifacts: {} },
				manifest: { config: {}, installs: [], modules: {} },
				removals: [],
				writes: [],
			},
			artifactCounts: { ".": 2, "apps/web": 1 },
			commandVersions: {},
			manifest: {
				config: plannedConfig,
				installs: [],
				modules: {},
				schemaVersion: 1,
			},
			markerPaths: ["apps/web/forge.json"],
		});

		expect(report).toMatch(/^Project:\s{2,}/);
		expect(report).toContain("Project:       2 existing artifacts");
		expect(report).toContain("apps/web:      web-app, 1 existing artifact");
		expect(report).toContain("Write marker:  apps/web/forge.json");
		expect(report).toContain(
			"We'll adopt admin (React Router, port 3003, calls the API) as a secondary web app.",
		);

		expect(report).toContain(
			`Forge will record this config:\n${JSON.stringify(plannedConfig, null, 2)}`,
		);

		expect(report).not.toContain("[object Object]");
	});

	it("captures existing bytes as bases and applies only module markers", async () => {
		await withTempDir("init-plan", async (directory) => {
			await fixture(directory);
			const secret = "DATABASE_URL=secret-do-not-capture\n";
			const example = "DATABASE_URL=file:local.db\n";
			await writeText(join(directory, ".env"), secret);
			await writeText(join(directory, ".env.example"), example);
			const beforeRoot = await readFile(
				join(directory, "package.json"),
				"utf-8",
			);

			const beforeWeb = await readFile(
				join(directory, "apps/web/package.json"),
				"utf-8",
			);

			const beforeDb = await readFile(
				join(directory, "packages/db/package.json"),
				"utf-8",
			);

			const plan = await Effect.runPromise(
				buildAdoptionPlanForTest(
					directory,
					{
						...config,
						database: "postgresql",
						databaseProvider: "supabase",
					},
					[
						{ kind: "web-app", root: "apps/web" },
						{ kind: "db", root: "packages/db" },
					],
					[
						{
							dependencies: [
								{
									name: "drizzle-orm",
									section: "dependencies",
									specifier: "1.0.0-rc.4",
									version: "1.0.0-rc.4",
								},
								{
									name: "drizzle-kit",
									section: "devDependencies",
									specifier: "0.31.0",
									version: "0.31.0",
								},
								{
									name: "postgres",
									section: "dependencies",
									specifier: "3.4.7",
									version: "3.4.7",
								},
							],
							root: "packages/db",
						},
					],
				),
			);

			expect(plan.markerPaths).toEqual([
				"apps/web/forge.json",
				"packages/db/forge.json",
			]);

			expect(plan.applyPlan.writes.map((write) => write.path)).toEqual(
				plan.markerPaths,
			);

			expect(
				Object.values(plan.manifest.modules)
					.map((module) => module.root)
					.sort(),
			).toEqual(["apps/web", "packages/db"]);

			expect(
				plan.manifest.installs.find(
					(install) => install.definitionId === "drizzle",
				)?.versions,
			).toEqual(
				expect.arrayContaining([
					{
						name: "drizzle-orm",
						root: "packages/db",
						section: "dependencies",
						specifier: "1.0.0-rc.4",
						version: "1.0.0-rc.4",
					},
					{
						name: "drizzle-kit",
						root: "packages/db",
						section: "devDependencies",
						specifier: "0.31.0",
						version: "0.31.0",
					},
					{
						name: "postgres",
						root: "packages/db",
						section: "dependencies",
						specifier: "3.4.7",
						version: "3.4.7",
					},
				]),
			);

			expect(
				Object.values(plan.applyPlan.lockfile.artifacts).some(
					(artifact) => artifact.path === ".env",
				),
			).toBe(false);

			const envExample = Object.entries(plan.applyPlan.lockfile.artifacts).find(
				([, artifact]) => artifact.path === ".env.example",
			);

			expect(envExample?.[1].base?.origin).toBe("adopted");
			expect(plan.applyPlan.baseContents?.[envExample?.[0] ?? "missing"]).toBe(
				example,
			);

			expect(Object.values(plan.applyPlan.baseContents ?? {})).not.toContain(
				secret,
			);

			await Effect.runPromise(
				Apply.applyPlan(directory, plan.applyPlan).pipe(
					Effect.provide(coreLayer),
				),
			);

			expect(await readFile(join(directory, "package.json"), "utf-8")).toBe(
				beforeRoot,
			);

			expect(
				await readFile(join(directory, "apps/web/package.json"), "utf-8"),
			).toBe(beforeWeb);

			expect(
				await readFile(join(directory, "packages/db/package.json"), "utf-8"),
			).toBe(beforeDb);

			expect(
				await readFile(join(directory, "apps/web/forge.json"), "utf-8"),
			).toContain('"type": "app"');

			const lockfile = await Effect.runPromise(
				State.readLockfile(directory).pipe(Effect.provide(coreLayer)),
			);

			const webPackage = Object.values(lockfile.artifacts).find(
				(artifact) => artifact.path === "apps/web/package.json",
			);

			expect(webPackage?.base?.hash).toBe(webPackage?.hash);
			await expect(
				Effect.runPromise(
					State.readBase(directory, webPackage?.base?.hash ?? "missing").pipe(
						Effect.provide(coreLayer),
					),
				),
			).resolves.toBe(beforeWeb);
		});
	});

	it.each([
		[
			"a Yarn pin and an exact .nvmrc",
			{ packageManager: "yarn@4.5.0" },
			"24.1.0\n",
			"Yarn",
			{ node: "24.1.0", yarn: "4.5.0" },
		],
		[
			"a pnpm pin and an engines range",
			{ packageManager: "pnpm@9.15.0", engines: { node: ">=22" } },
			undefined,
			"pnpm",
			{ node: "22.11.0", pnpm: "9.15.0" },
		],
	] satisfies ReadonlyArray<
		readonly [
			string,
			Record<string, unknown>,
			string | undefined,
			"Yarn" | "pnpm",
			Record<string, string>,
		]
	>)(
		"records versions from %s without probing pinned commands",
		async (_label, rootFields, nvmrc, packageManager, commandVersions) => {
			await withTempDir("init-pins", async (directory) => {
				await fixture(directory);
				await writeJson(join(directory, "package.json"), {
					name: "acme",
					private: true,
					...rootFields,
				});

				if (nvmrc !== undefined)
					await writeText(join(directory, ".nvmrc"), nvmrc);

				const plan = await Effect.runPromise(
					buildAdoptionPlanForTest(
						directory,
						{ ...config, packageManager },
						[{ kind: "web-app", root: "apps/web" }],
						[],
					),
				);

				expect(plan.commandVersions).toEqual(commandVersions);
			});
		},
	);

	it("maps a backend app onto the standalone hono prototype", async () => {
		await withTempDir("init-backend", async (directory) => {
			await fixture(directory);
			await writeJson(join(directory, "apps/api/package.json"), {
				dependencies: { "@hono/node-server": "^2.1.0", hono: "^4.10.3" },
				name: "@acme/api",
				private: true,
			});

			const plan = await Effect.runPromise(
				buildAdoptionPlanForTest(
					directory,
					{ ...config, backend: "hono" },
					[
						{ kind: "web-app", root: "apps/web" },
						{ kind: "backend-app", root: "apps/api" },
					],
					[],
				),
			);

			expect(
				Object.values(plan.manifest.modules)
					.map((module) => module.root)
					.sort(),
			).toEqual(["apps/api", "apps/web"]);

			const marker = plan.applyPlan.writes.find(
				(write) => write.path === "apps/api/forge.json",
			);

			expect(marker?.content).toContain('"framework": "hono"');
			expect(marker?.content).toContain('"trpc": "src/routes/trpc.ts"');
		});
	});

	it("adopts mixed frameworks with each matching template", async () => {
		await withTempDir("init-mixed-frameworks", async (directory) => {
			await fixture(directory);
			await writeJson(join(directory, "apps/web/package.json"), {
				dependencies: { "@tanstack/react-start": "^1.0.0" },
				name: "@acme/web",
			});

			await writeJson(join(directory, "apps/admin/package.json"), {
				dependencies: { next: "^16.0.0" },
				name: "@acme/admin",
				scripts: { dev: "next dev --port 3002" },
			});

			const plan = await Effect.runPromise(
				buildAdoptionPlanForTest(
					directory,
					{
						...config,
						web: "tanstack-start",
						webApps: [{ name: "admin", framework: "nextjs" }],
					},
					[
						{ kind: "web-app", root: "apps/web" },
						{ kind: "web-app", root: "apps/admin" },
					],
					[],
				),
			);

			expect(
				plan.applyPlan.writes.find(
					(write) => write.path === "apps/web/forge.json",
				)?.content,
			).toContain('"framework": "tanstack-start"');

			expect(
				plan.applyPlan.writes.find(
					(write) => write.path === "apps/admin/forge.json",
				)?.content,
			).toContain('"framework": "nextjs"');
		});
	});

	it("adopts alphabetical siblings while keeping addons on apps/web", async () => {
		await withTempDir("init-primary-web", async (directory) => {
			await fixture(directory);
			await writeJson(join(directory, "apps/admin/package.json"), {
				dependencies: { next: "16.0.0" },
				scripts: { dev: "next dev --port 3002" },
			});

			const beforeAdmin = await readFile(
				join(directory, "apps/admin/package.json"),
				"utf-8",
			);

			const beforeWeb = await readFile(
				join(directory, "apps/web/package.json"),
				"utf-8",
			);

			const plan = await Effect.runPromise(
				buildAdoptionPlanForTest(
					directory,
					{ ...config, orm: undefined, rpc: "trpc" },
					[
						{ kind: "web-app", root: "apps/admin" },
						{ kind: "web-app", root: "apps/web" },
					],
					[],
				),
			);

			const web = Object.entries(plan.manifest.modules).find(
				([, module]) => module.root === "apps/web",
			);

			expect(
				Object.values(plan.manifest.modules)
					.map((module) => module.root)
					.sort(),
			).toEqual(["apps/admin", "apps/web"]);

			expect(
				plan.applyPlan.writes.find(
					(write) => write.path === "apps/web/forge.json",
				)?.content,
			).toContain('"role": "primary"');

			expect(
				plan.applyPlan.writes.find(
					(write) => write.path === "apps/admin/forge.json",
				)?.content,
			).not.toContain('"role": "primary"');

			expect(
				plan.manifest.installs.find(
					(install) => install.definitionId === "trpc",
				)?.targets,
			).toEqual([{ kind: "module", moduleId: web?.[0] }]);

			await Effect.runPromise(
				Apply.applyPlan(directory, plan.applyPlan).pipe(
					Effect.provide(coreLayer),
				),
			);

			expect(
				await readFile(join(directory, "apps/admin/package.json"), "utf-8"),
			).toBe(beforeAdmin);

			expect(
				await readFile(join(directory, "apps/web/package.json"), "utf-8"),
			).toBe(beforeWeb);

			expect(
				await readFile(join(directory, "apps/web/forge.json"), "utf-8"),
			).toContain('"role": "primary"');
		});
	});

	it("does not recreate a rejected detected secondary", async () => {
		await withTempDir("init-rejected-secondary", async (directory) => {
			await fixture(directory);
			await writeJson(join(directory, "apps/admin/package.json"), {
				dependencies: { "react-router": "7.0.0" },
			});

			const plan = await Effect.runPromise(
				buildAdoptionPlanForTest(
					directory,
					{
						...config,
						orm: undefined,
						webApps: [],
					},
					[{ kind: "web-app", root: "apps/web" }],
					[],
					[
						{
							root: "apps/admin",
							proposal: "web-app",
							evidence: "react-router",
						},
						{ root: "apps/web", proposal: "web-app", evidence: "next" },
					],
				),
			);

			expect(plan.manifest.config.webApps).toEqual([]);
			expect(
				Object.values(plan.manifest.modules).map((module) => module.root),
			).toEqual(["apps/web"]);

			expect(
				plan.manifest.installs.map((install) => install.definitionId),
			).not.toContain("react-router");

			expect(
				Object.values(plan.applyPlan.lockfile.artifacts).some((artifact) =>
					artifact.path.startsWith("apps/admin/"),
				),
			).toBe(false);
		});
	});

	it("promotes a confirmed secondary with its actual framework", async () => {
		await withTempDir("init-promoted-secondary", async (directory) => {
			await fixture(directory);
			await writeJson(join(directory, "apps/admin/package.json"), {
				dependencies: { "react-router": "7.0.0" },
			});

			const plan = await Effect.runPromise(
				buildAdoptionPlanForTest(
					directory,
					{
						...config,
						orm: undefined,
						webApps: [],
					},
					[{ kind: "web-app", root: "apps/admin" }],
					[],
				),
			);

			expect(plan.manifest.config.web).toBe("react-router");
			expect(plan.manifest.config.webApps).toEqual([]);
			expect(plan.markerPaths).toEqual(["apps/admin/forge.json"]);
			expect(
				plan.applyPlan.writes.find(
					(write) => write.path === "apps/admin/forge.json",
				)?.content,
			).toContain('"framework": "react-router"');
		});
	});

	it("adopts same-framework secondaries outside the generated layout", async () => {
		await withTempDir("init-secondary-layout", async (directory) => {
			await fixture(directory);
			await writeJson(join(directory, "sites/admin/package.json"), {
				dependencies: { next: "16.0.0" },
			});

			const plan = await Effect.runPromise(
				buildAdoptionPlanForTest(
					directory,
					{
						...config,
						orm: undefined,
						webApps: [{ name: "admin", framework: "nextjs", port: 3002 }],
					},
					[
						{ kind: "web-app", root: "apps/web" },
						{ kind: "web-app", root: "sites/admin" },
					],
					[],
				),
			);

			expect(plan.manifest.config.webApps).toEqual([
				{ name: "admin", framework: "nextjs", port: 3002 },
			]);

			expect(plan.markerPaths.sort()).toEqual([
				"apps/web/forge.json",
				"sites/admin/forge.json",
			]);

			expect(
				plan.applyPlan.writes.find(
					(write) => write.path === "sites/admin/forge.json",
				)?.content,
			).toContain('"framework": "nextjs"');

			expect(
				Object.values(plan.applyPlan.lockfile.artifacts).some((artifact) =>
					artifact.path.startsWith("apps/admin/"),
				),
			).toBe(false);
		});
	});

	it("rejects ambiguous secondary identities across layouts", async () => {
		await withTempDir("init-ambiguous-secondary", async (directory) => {
			await fixture(directory);

			for (const [root, port] of [
				["sites/admin", 3002],
				["apps/admin", 3003],
			] satisfies ReadonlyArray<readonly [string, number]>)
				await writeJson(join(directory, root, "package.json"), {
					dependencies: { next: "16.0.0" },
					scripts: { dev: `next dev --port ${port}` },
				});

			const error = await Effect.runPromise(
				Effect.flip(
					buildAdoptionPlanForTest(
						directory,
						{
							...config,
							orm: undefined,
							webApps: [{ name: "admin", framework: "nextjs" }],
						},
						[
							{ kind: "web-app", root: "apps/web" },
							{ kind: "web-app", root: "sites/admin" },
							{ kind: "web-app", root: "apps/admin" },
						],
						[],
					),
				),
			);

			expect(error.message).toBe(
				"We couldn't adopt apps/admin and sites/admin because each would be the web app named admin. Rename one package and run forge init again.",
			);
		});
	});

	it("preserves a moved single primary app", async () => {
		await withTempDir("init-moved-primary", async (directory) => {
			await writeJson(join(directory, "package.json"), {
				name: "acme",
				workspaces: ["apps/*"],
			});

			await writeJson(join(directory, "apps/site/package.json"), {
				dependencies: { next: "16.0.0" },
			});

			const plan = await Effect.runPromise(
				buildAdoptionPlanForTest(
					directory,
					{ ...config, orm: undefined, rpc: "trpc" },
					[{ kind: "web-app", root: "apps/site" }],
					[],
				),
			);

			expect(plan.markerPaths).toEqual(["apps/site/forge.json"]);
			expect(
				Object.values(plan.applyPlan.lockfile.artifacts).some((artifact) =>
					artifact.path.startsWith("apps/web/"),
				),
			).toBe(false);

			expect(
				plan.manifest.installs.find(
					(install) => install.definitionId === "trpc",
				)?.targets,
			).toHaveLength(1);
		});
	});

	it("reports invalid mappings", async () => {
		await withTempDir("init-invalid-mapping", async (directory) => {
			await fixture(directory);

			const invalidMapping = await Effect.runPromise(
				Effect.flip(
					buildAdoptionPlanForTest(
						directory,
						config,
						[{ kind: "auth", root: "apps/web" }],
						[],
					),
				),
			);

			if (!(invalidMapping instanceof Error))
				throw new Error("Expected an invalid mapping error");

			expect(invalidMapping.message).toBe(
				"Adoption Mapping Invalid: apps/web cannot be mapped as auth with this configuration.",
			);
		});
	});

	it("reports capture hashing failures", async () => {
		await withTempDir("init-hashing-failure", async (directory) => {
			await fixture(directory);

			const crypto = globalThis.crypto;
			vi.stubGlobal("crypto", {
				getRandomValues: crypto.getRandomValues.bind(crypto),
				randomUUID: crypto.randomUUID.bind(crypto),
				subtle: {
					digest: (...parameters: Parameters<typeof crypto.subtle.digest>) => {
						const data = parameters[1];
						const bytes = ArrayBuffer.isView(data)
							? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
							: new Uint8Array(data);

						return new TextDecoder().decode(bytes).includes("keep-me")
							? Promise.reject(new Error("digest failed"))
							: crypto.subtle.digest(...parameters);
					},
				},
			});

			try {
				const hashingFailure = await Effect.runPromise(
					Effect.flip(
						buildAdoptionPlanForTest(
							directory,
							config,
							[
								{ kind: "web-app", root: "apps/web" },
								{ kind: "db", root: "packages/db" },
							],
							[],
						),
					),
				);

				if (!(hashingFailure instanceof Error))
					throw new Error("Expected a content hashing error");

				expect(hashingFailure.message).toBe(
					"Content Hash Failed: package.json",
				);
			} finally {
				vi.unstubAllGlobals();
			}
		});
	});

	it("retargets module installs to every adopted prototype and filters pins", async () => {
		await withTempDir("init-multi-target", async (directory) => {
			await fixture(directory);
			await writeJson(join(directory, "apps/admin/package.json"), {
				dependencies: { next: "^16.0.0", react: "^19.0.0" },
				name: "@acme/admin",
				private: true,
				scripts: { dev: "next dev --port 3002" },
			});

			const plan = await Effect.runPromise(
				buildAdoptionPlanForTest(
					directory,
					config,
					[
						{ kind: "web-app", root: "apps/admin" },
						{ kind: "web-app", root: "apps/web" },
						{ kind: "db", root: "packages/db" },
					],
					[
						{
							dependencies: [
								{
									name: "drizzle-orm",
									section: "dependencies",
									specifier: "1.0.0-rc.4",
									version: "1.0.0-rc.4",
								},
							],
							root: "packages/db",
						},
						{
							dependencies: [
								{
									name: "drizzle-orm",
									section: "dependencies",
									specifier: "9.9.9",
									version: "9.9.9",
								},
							],
							root: "packages/rejected-db",
						},
					],
				),
			);

			const ui = plan.manifest.installs.find(
				(install) => install.definitionId === "ui",
			);

			const appIds = Object.entries(plan.manifest.modules).flatMap(
				([id, module]) =>
					module.root?.startsWith("apps/") === true ? [id] : [],
			);

			expect(ui?.targets).toHaveLength(appIds.length);
			expect(ui?.targets).toEqual(
				expect.arrayContaining(
					appIds.map((moduleId) => ({ kind: "module", moduleId })),
				),
			);

			expect(
				plan.manifest.installs
					.flatMap((install) => install.versions ?? [])
					.map((version) => version.root),
			).not.toContain("packages/rejected-db");
		});
	});

	it("runs dry-run, apply, managed refusal, and reconcile through the command", async () => {
		await withTempDir("init-command", async (directory) => {
			await fixture(directory);
			const configPath = join(directory, "forge.init.json");
			await writeJson(configPath, {
				...config,
				modules: [
					{ kind: "web-app", root: "apps/web" },
					{ kind: "db", root: "packages/db" },
				],
			});

			await runInit({ config: configPath, "dry-run": true }, directory);
			expect(await exists(join(directory, ".forge"))).toBe(false);
			expect(await exists(join(directory, "apps/web/forge.json"))).toBe(false);

			await runInit({ config: configPath }, directory);
			expect(await exists(join(directory, ".forge/manifest.json"))).toBe(true);
			expect(await exists(join(directory, "apps/web/forge.json"))).toBe(true);

			const exit = vi.spyOn(process, "exit").mockImplementation(() => {
				throw new Error("exit:1");
			});

			try {
				await expect(
					runInit({ config: configPath }, directory),
				).rejects.toThrow("exit:1");
			} finally {
				exit.mockRestore();
			}
		});

		await withTempDir("init-command-reconcile", async (directory) => {
			await fixture(directory);
			const configPath = join(directory, "forge.init.json");
			await writeJson(configPath, {
				...config,
				modules: [
					{ kind: "web-app", root: "apps/web" },
					{ kind: "db", root: "packages/db" },
				],
			});

			await runInit(
				{ config: configPath, "keep-user": true, reconcile: true },
				directory,
			);

			const packageJson = JSON.parse(
				await readFile(join(directory, "package.json"), "utf-8"),
			);

			expect(packageJson.scripts.user).toBe("keep-me");
			expect(packageJson.scripts.build).toBe("turbo run build");
		});
	}, 30_000);

	it("accepts detected values and mappings with yes", async () => {
		await withTempDir("init-command-yes", async (directory) => {
			await fixture(directory);
			await runInit({ "dry-run": true, yes: true }, directory);
			expect(await exists(join(directory, ".forge"))).toBe(false);
		});
	});

	it("adopts a detected multi app tree with its names, ports and clients", async () => {
		await withTempDir("init-detected-web-apps", async (directory) => {
			await fixture(directory);
			await writeJson(join(directory, "apps/site/package.json"), {
				dependencies: { "@acme/trpc": "workspace:*", next: "^16.0.0" },
				name: "@acme/site",
				scripts: { dev: "next dev --port 3002" },
			});

			await writeJson(join(directory, "apps/Admin_Panel/package.json"), {
				dependencies: { "react-router": "^7.0.0" },
				name: "@acme/admin",
				scripts: { dev: "react-router dev --port 3004" },
			});

			await writeJson(join(directory, "packages/trpc/package.json"), {
				dependencies: { "@trpc/server": "^11.0.0" },
				name: "@acme/trpc",
			});

			const before = await snapshot(directory);
			await runInit({ "dry-run": true, yes: true }, directory);
			expect(await snapshot(directory)).toEqual(before);

			await runInit({ yes: true }, directory);
			const manifest = JSON.parse(
				await readFile(join(directory, ".forge/manifest.json"), "utf-8"),
			);

			expect(manifest.config).toMatchObject({
				platforms: ["web"],
				rpc: "trpc",
				web: "nextjs",
				webApps: [
					{ name: "admin", framework: "react-router", port: 3004 },
					{ name: "site", framework: "nextjs", port: 3002, client: true },
				],
			});

			expect(
				await readFile(join(directory, "apps/Admin_Panel/forge.json"), "utf-8"),
			).toContain('"framework": "react-router"');
		});
	}, 30_000);

	it("adopts detected oRPC and installs it on the web host with yes", async () => {
		await withTempDir("init-detected-orpc", async (directory) => {
			await fixture(directory);
			await writeJson(join(directory, "packages/orpc/package.json"), {
				dependencies: { "@orpc/server": "^1.0.0" },
				name: "@acme/orpc",
			});

			await writeText(
				join(directory, "packages/orpc/src/router.ts"),
				"export const router = {};\n",
			);

			await writeJson(join(directory, "apps/web/package.json"), {
				dependencies: {
					"@acme/orpc": "workspace:*",
					next: "^16.0.0",
					react: "^19.0.0",
				},
				name: "@acme/web",
				private: true,
			});

			await runInit({ yes: true }, directory);
			const manifest = await Effect.runPromise(
				State.readManifest(directory).pipe(Effect.provide(coreLayer)),
			);

			expect(manifest.config.rpc).toBe("orpc");
			expect(Object.values(manifest.modules)).toContainEqual(
				expect.objectContaining({ root: "packages/orpc" }),
			);

			const host = Object.entries(manifest.modules).find(
				([, module]) => module.root === "apps/web",
			);

			expect(host).toBeDefined();
			expect(manifest.installs).toContainEqual(
				expect.objectContaining({
					definitionId: "orpc",
					targets: [{ kind: "module", moduleId: host?.[0] }],
				}),
			);
		});
	}, 30_000);

	it.each([
		["yes", { yes: true }],
		["a config file", { config: "forge.init.json" }],
	])("refuses to pick a primary web app with %s", async (_mode, values) => {
		await withTempDir("init-no-primary", async (directory) => {
			await writeJson(join(directory, "package.json"), { name: "acme" });
			await writeText(
				join(directory, "pnpm-workspace.yaml"),
				"packages:\n  - 'apps/*'\n",
			);

			await writeJson(join(directory, "apps/admin/package.json"), {
				dependencies: { "react-router": "^7.0.0" },
				scripts: { dev: "react-router dev --port 3004" },
			});

			await writeJson(join(directory, "apps/frontend/package.json"), {
				dependencies: { next: "^16.0.0" },
				scripts: { dev: "next dev --port 3002" },
			});

			await writeJson(join(directory, "forge.init.json"), {
				...config,
				modules: [
					{ kind: "web-app", root: "apps/admin" },
					{ kind: "web-app", root: "apps/frontend" },
				],
			});

			const exit = vi.spyOn(process, "exit").mockImplementation(() => {
				throw new Error("exit:1");
			});

			const logError = vi.spyOn(log, "error").mockImplementation(() => {});
			try {
				await expect(
					runInit(
						"config" in values
							? { config: join(directory, values.config) }
							: values,
						directory,
					),
				).rejects.toThrow("exit:1");

				expect(logError).toHaveBeenCalledWith(
					"We couldn't choose a primary web app because apps/web isn't being adopted. Run forge init interactively and choose one.",
				);

				expect(await exists(join(directory, ".forge"))).toBe(false);
			} finally {
				logError.mockRestore();
				exit.mockRestore();
			}
		});
	});

	it("adopts a client of the confirmed provider when the other is declined", async () => {
		await withTempDir("init-declined-provider", async (directory) => {
			await fixture(directory);
			await writeJson(join(directory, "apps/site/package.json"), {
				dependencies: { "@acme/trpc": "workspace:*", next: "^16.0.0" },
				name: "@acme/site",
				scripts: { dev: "next dev --port 3002" },
			});

			for (const provider of ["trpc", "orpc"])
				await writeJson(join(directory, `packages/${provider}/package.json`), {
					dependencies: { [`@${provider}/server`]: "^1.0.0" },
					name: `@acme/${provider}`,
				});

			const configPath = join(directory, "forge.init.json");
			await writeJson(configPath, {
				...config,
				rpc: "trpc",
				modules: [
					{ kind: "web-app", root: "apps/web" },
					{ kind: "web-app", root: "apps/site" },
					{ kind: "db", root: "packages/db" },
					{ kind: "trpc", root: "packages/trpc" },
				],
			});

			await runInit({ config: configPath }, directory);
			const manifest = JSON.parse(
				await readFile(join(directory, ".forge/manifest.json"), "utf-8"),
			);

			expect(manifest.config.webApps).toEqual([
				{ name: "site", framework: "nextjs", client: true, port: 3002 },
			]);
		});
	}, 30_000);

	it("refuses unbindable apps under yes before announcing them", async () => {
		await withTempDir("init-early-refusal", async (directory) => {
			await writeJson(join(directory, "package.json"), { name: "acme" });
			await writeText(
				join(directory, "pnpm-workspace.yaml"),
				"packages:\n  - 'apps/*'\n",
			);

			await writeJson(join(directory, "apps/web/package.json"), {
				dependencies: { next: "^16.0.0" },
			});

			for (const [root, name, port] of [
				["apps/marketing", "@company/site", 3002],
				["apps/console", "@company/admin", 3003],
			] satisfies ReadonlyArray<readonly [string, string, number]>)
				await writeJson(join(directory, root, "package.json"), {
					dependencies: { next: "^16.0.0" },
					name,
					scripts: { dev: `next dev --port ${port}` },
				});

			const exit = vi.spyOn(process, "exit").mockImplementation(() => {
				throw new Error("exit:1");
			});

			const logError = vi.spyOn(log, "error").mockImplementation(() => {});
			const logMessage = vi.spyOn(log, "message").mockImplementation(() => {});
			try {
				await expect(runInit({ yes: true }, directory)).rejects.toThrow(
					"exit:1",
				);

				expect(logMessage).not.toHaveBeenCalled();
				expect(logError).toHaveBeenCalledWith(
					expect.stringMatching(
						/^We couldn't adopt apps\/console and apps\/marketing because .* Forge guessed the slug acme\. To use another, set slug in an init config and pass it with --config\.$/,
					),
				);

				expect(await exists(join(directory, ".forge"))).toBe(false);
			} finally {
				logMessage.mockRestore();
				logError.mockRestore();
				exit.mockRestore();
			}
		});
	});

	it("reports detection, mapping, and planning failures", async () => {
		const exit = vi.spyOn(process, "exit").mockImplementation(() => {
			throw new Error("exit:1");
		});

		try {
			await withTempDir("init-detection-error", async (directory) => {
				await writeText(
					join(directory, "pnpm-workspace.yaml"),
					"packages:\n  - 'apps/*'\n",
				);

				await writeText(join(directory, "apps/web/package.json"), "{broken");
				await expect(runInit({ yes: true }, directory)).rejects.toThrow(
					"exit:1",
				);
			});

			await withTempDir("init-mapping-error", async (directory) => {
				await fixture(directory);
				const unknownPath = join(directory, "unknown.json");
				await writeJson(unknownPath, {
					...config,
					modules: [{ kind: "web-app", root: "apps/missing" }],
				});

				await expect(
					runInit({ config: unknownPath }, directory),
				).rejects.toThrow("exit:1");

				const duplicatePath = join(directory, "duplicate.json");
				await writeJson(duplicatePath, {
					...config,
					modules: [
						{ kind: "web-app", root: "apps/web" },
						{ kind: "web-app", root: "apps/web" },
					],
				});

				await expect(
					runInit({ config: duplicatePath }, directory),
				).rejects.toThrow("exit:1");

				const invalidPlanPath = join(directory, "invalid-plan.json");
				await writeJson(invalidPlanPath, {
					...config,
					modules: [{ kind: "auth", root: "apps/web" }],
				});

				await expect(
					runInit({ config: invalidPlanPath }, directory),
				).rejects.toThrow("exit:1");
			});
		} finally {
			exit.mockRestore();
		}
	});

	it("reports root package name failures through the init boundary", async () => {
		await withTempDir("init-root-name-error", async (directory) => {
			await fixture(directory);
			const filePath = join(directory, "package.json");
			const failure = new AdoptionFileReadError({
				detail: "Synthetic root package read failure",
				filePath,
				message: `Adoption File Read Failed: ${filePath}`,
			});

			const detectorOverride = Layer.effect(
				AdoptionDetector,
				Effect.map(AdoptionDetector, (detector) => ({
					...detector,
					rootPackageName: () => Effect.fail(failure),
				})),
			).pipe(Layer.provide(cliLayer));

			const runtime = ManagedRuntime.make(
				Layer.merge(cliLayer, detectorOverride),
			);

			const exit = vi
				.spyOn(process, "exit")
				.mockImplementation((code?: string | number | null): never => {
					throw new Error(`exit:${code ?? 0}`);
				});

			try {
				await expect(
					withCliRuntime(() => runInit({ yes: true }, directory), runtime),
				).rejects.toThrow("exit:1");

				expect(exit).toHaveBeenCalledWith(1);
			} finally {
				exit.mockRestore();
			}
		});
	});

	it("refuses a rejected workspace module required by the confirmed graph", async () => {
		await withTempDir("init-required-rejection", async (directory) => {
			await fixture(directory);
			await writeJson(join(directory, "packages/ui/package.json"), {
				dependencies: { "@base-ui/react": "^1.0.0" },
				name: "@acme/ui",
				private: true,
			});

			const configPath = join(directory, "forge.init.json");
			await writeJson(configPath, {
				addons: [],
				catalogs: "flat",
				linter: "biome",
				modules: [{ kind: "web-app", root: "apps/web" }],
				name: "Acme",
				packageManager: "pnpm",
				path: ".",
				platforms: ["web"],
				runtime: "Node.js",
				slug: "acme",
				web: "nextjs",
			});

			const exit = vi.spyOn(process, "exit").mockImplementation(() => {
				throw new Error("exit:1");
			});

			try {
				await expect(
					runInit({ config: configPath }, directory),
				).rejects.toThrow("exit:1");

				expect(await exists(join(directory, ".forge"))).toBe(false);
			} finally {
				exit.mockRestore();
			}
		});
	});

	it("reports an apply failure without publishing state", async () => {
		await withTempDir("init-apply-error", async (directory) => {
			await fixture(directory);
			await mkdir(join(directory, "apps/web/forge.json"));
			const configPath = join(directory, "forge.init.json");
			await writeJson(configPath, {
				...config,
				modules: [
					{ kind: "web-app", root: "apps/web" },
					{ kind: "db", root: "packages/db" },
				],
			});

			const exit = vi.spyOn(process, "exit").mockImplementation(() => {
				throw new Error("exit:1");
			});

			try {
				await expect(
					runInit({ config: configPath }, directory),
				).rejects.toThrow("exit:1");

				expect(await exists(join(directory, ".forge/manifest.json"))).toBe(
					false,
				);
			} finally {
				exit.mockRestore();
			}
		});
	});
});
