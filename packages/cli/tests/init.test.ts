import { access, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { NodeContext } from "@effect/platform-node";
import { Apply, CoreLive, State } from "@ryuujs/core";
import { type ForgeConfig, loadDefinitionRegistry } from "@ryuujs/generators";
import { Cause, Effect, Layer } from "effect";
import { describe, expect, it, vi } from "vitest";
import type { ModuleKind } from "../src/commands/adoption";
import {
	adoptionConflictGuidance,
	adoptionOutro,
	adoptionReport,
	buildAdoptionPlan,
	contentHashError,
	defaultIdentity,
	effectFailure,
	readInitConfigFile,
	runInit,
} from "../src/commands/init";
import { withTempDir, writeJson, writeText } from "./lifecycle-fixtures";

const coreLayer = CoreLive.pipe(Layer.provideMerge(NodeContext.layer));

const config: ForgeConfig = {
	addons: [],
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
		"packages:\n  - 'apps/*'\n  - 'packages/*'\n",
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

async function exists(path: string) {
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
}

describe("init command", () => {
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

	it("keeps package module kinds congruent with the first-party registry", () => {
		const loaded = loadDefinitionRegistry();
		const packageKinds: ReadonlyArray<Exclude<ModuleKind, "web-app">> = [
			"db",
			"auth",
			"trpc",
			"ui",
		];
		const packageAddons = {
			auth: "better-auth",
			db: "drizzle",
			trpc: "trpc",
			ui: "ui",
		} satisfies Readonly<Record<Exclude<ModuleKind, "web-app">, string>>;

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
				frameworks: [],
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
		expect(() => effectFailure(Cause.die(new Error("defect")))).toThrow(
			"defect",
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

	it("formats an aligned adoption report with project counts and grammar", () => {
		const report = adoptionReport(
			config,
			[{ kind: "web-app", root: "apps/web" }],
			{
				applyPlan: {
					lockfile: { artifacts: {} },
					manifest: { config: {}, installs: [], modules: {} },
					removals: [],
					writes: [],
				},
				artifactCounts: { ".": 2, "apps/web": 1 },
				commandVersions: {},
				manifest: {
					config: {},
					installs: [],
					modules: {},
					schemaVersion: 1,
				},
				markerPaths: ["apps/web/forge.json"],
			},
		);

		expect(report).toMatch(/^Config:\s{2,}/);
		expect(report).toContain("name=Acme");
		expect(report).not.toContain(JSON.stringify(config));
		expect(report).toContain("Project:       2 existing artifacts");
		expect(report).toContain("apps/web:      web-app, 1 existing artifact");
		expect(report).toContain("Write marker:  apps/web/forge.json");
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
				buildAdoptionPlan(
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

	it("reports invalid mappings and capture hashing failures", async () => {
		await withTempDir("init-plan-failures", async (directory) => {
			await fixture(directory);

			const invalidMapping = await Effect.runPromise(
				Effect.flip(
					buildAdoptionPlan(
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
						buildAdoptionPlan(
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
			});

			const plan = await Effect.runPromise(
				buildAdoptionPlan(
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
			expect(ui?.targets).toEqual(
				appIds.map((moduleId) => ({ kind: "module", moduleId })),
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
