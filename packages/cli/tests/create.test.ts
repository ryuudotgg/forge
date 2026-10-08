import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeServices } from "@effect/platform-node";
import { CliVersion, CoreLive, Planner } from "@ryuugg/core";
import {
	builtins,
	type ForgeConfig,
	probeWorkspaceCommandVersions,
} from "@ryuugg/generators";
import { Effect, Layer } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { runCreate } from "../src/commands/create";
import { defaultPreset } from "../src/presets/default";
import { steps } from "../src/steps";

const promptMocks = vi.hoisted(() => ({
	logError: vi.fn(),
}));

const orchestratorMocks = vi.hoisted(() => ({
	orchestrate: vi.fn(),
}));

vi.mock("@clack/prompts", () => ({
	log: { error: promptMocks.logError },
}));

vi.mock("../src/orchestrator", () => ({
	orchestrate: orchestratorMocks.orchestrate,
}));

async function withTempDir<T>(
	name: string,
	run: (directory: string) => Promise<T>,
) {
	const directory = await mkdtemp(join(tmpdir(), `forge-${name}-`));
	try {
		return await run(directory);
	} finally {
		await rm(directory, { force: true, recursive: true });
	}
}

describe("create command", () => {
	beforeEach(() => {
		orchestratorMocks.orchestrate.mockReset();
		promptMocks.logError.mockReset();
	});

	it.each(["web", "vault"])(
		"passes the explicit primary name %s from flags to orchestration",
		async (webName) => {
			await runCreate({ web: ["nextjs"], "web-name": webName });

			expect(orchestratorMocks.orchestrate).toHaveBeenCalledWith(steps, {
				initialConfig: { web: "nextjs", webName },
				interactive: true,
			});
		},
	);

	it.each(["web", "vault"])(
		"passes the explicit primary name %s from a config file to orchestration",
		async (webName) => {
			await withTempDir("create-primary-name", async (directory) => {
				const configPath = join(directory, "forge.config.json");
				await writeFile(configPath, JSON.stringify({ web: "nextjs", webName }));

				await runCreate({ config: configPath });

				expect(orchestratorMocks.orchestrate).toHaveBeenCalledWith(steps, {
					initialConfig: { web: "nextjs", webName },
					interactive: false,
				});
			});
		},
	);

	it.each([
		[
			"Vault",
			"Vault isn't a valid web app name. Start with a lowercase letter and use only lowercase letters, numbers and hyphens.",
		],
		["server", "server is reserved. Pick another name for this web app."],
		["biome", "biome is an addon id. Pick another name for this web app."],
		["site", "site names both the primary web app and a secondary one."],
	])(
		"refuses the config primary name %s before orchestration",
		async (webName, sentence) => {
			await withTempDir("create-invalid-primary-name", async (directory) => {
				const configPath = join(directory, "forge.config.json");
				await writeFile(
					configPath,
					JSON.stringify({
						web: "tanstack-router",
						webName,
						webApps: [{ name: "site", framework: "nextjs" }],
					}),
				);

				const exit = vi.spyOn(process, "exit").mockImplementation((code) => {
					throw new Error(`exit:${code ?? 0}`);
				});

				try {
					await expect(runCreate({ config: configPath })).rejects.toThrow(
						"exit:1",
					);

					expect(promptMocks.logError).toHaveBeenCalledWith(sentence);
					expect(orchestratorMocks.orchestrate).not.toHaveBeenCalled();
				} finally {
					exit.mockRestore();
				}
			});
		},
	);

	it.each([
		[
			{ web: ["tanstack-router", "site=nextjs"], "web-name": "site" },
			"site names both the primary web app and a secondary one.",
		],
		[
			{ web: ["nextjs", "web=tanstack-router"] },
			"web names both the primary web app and a secondary one.",
		],
	])(
		"refuses a flag secondary that takes the primary name",
		async (values, sentence) => {
			const exit = vi.spyOn(process, "exit").mockImplementation((code) => {
				throw new Error(`exit:${code ?? 0}`);
			});

			try {
				await expect(runCreate(values)).rejects.toThrow("exit:1");
				expect(promptMocks.logError).toHaveBeenCalledWith(sentence);
				expect(orchestratorMocks.orchestrate).not.toHaveBeenCalled();
			} finally {
				exit.mockRestore();
			}
		},
	);

	it("accepts a flag secondary named web beside a config primary name", async () => {
		await withTempDir("create-merged-primary-name", async (directory) => {
			const configPath = join(directory, "forge.config.json");
			await writeFile(
				configPath,
				JSON.stringify({ web: "tanstack-router", webName: "vault" }),
			);

			await runCreate({
				config: configPath,
				web: ["tanstack-router", "web=nextjs"],
			});

			expect(orchestratorMocks.orchestrate).toHaveBeenCalledWith(steps, {
				initialConfig: {
					web: "tanstack-router",
					webName: "vault",
					webApps: [{ name: "web", framework: "nextjs" }],
				},
				interactive: false,
			});
		});
	});

	it("refuses every unknown config key before decoding choices", async () => {
		await withTempDir("create-unknown-keys", async (directory) => {
			const configPath = join(directory, "forge.config.json");
			await writeFile(
				configPath,
				JSON.stringify({
					auth: "invalid",
					databse: "postgresql",
					email: "resend",
					"database-provider": "neon",
					"package-manager": "pnpm",
					"native-style": "nativewind",
					DataBase: "sqlite",
					x: "test",
				}),
			);

			const exit = vi.spyOn(process, "exit").mockImplementation((code) => {
				throw new Error(`exit:${code ?? 0}`);
			});

			try {
				await expect(runCreate({ config: configPath })).rejects.toThrow(
					"exit:1",
				);

				expect(promptMocks.logError.mock.calls).toEqual([
					[
						'Your config file sets "auth", which isn\'t a setting. Did you mean "authentication"?',
					],
					[
						'Your config file sets "databse", which isn\'t a setting. Did you mean "database"?',
					],
					[
						'Your config file sets "email", which isn\'t a setting. Did you mean "emailProvider"?',
					],
					[
						'Your config file sets "database-provider", which isn\'t a setting. Did you mean "databaseProvider"?',
					],
					[
						'Your config file sets "package-manager", which isn\'t a setting. Did you mean "packageManager"?',
					],
					[
						'Your config file sets "native-style", which isn\'t a setting. Did you mean "nativeStyleFramework"?',
					],
					[
						'Your config file sets "DataBase", which isn\'t a setting. Did you mean "database"?',
					],
					[
						'Your config file sets "x", which isn\'t a setting. Did you mean "web"?',
					],
				]);

				expect(orchestratorMocks.orchestrate).not.toHaveBeenCalled();
			} finally {
				exit.mockRestore();
			}
		});
	});

	it.each([
		{
			config: { database: "PostgreSQL", databaseProvider: "Turso" },
			flags: { database: "PostgreSQL", "database-provider": "Turso" },
			message:
				"Turso doesn't host PostgreSQL, so pick PlanetScale, Neon, Nile, Supabase, or Prisma Postgres.",
		},
		{
			config: { database: "SQLite", databaseProvider: "PlanetScale" },
			flags: { database: "SQLite", "database-provider": "PlanetScale" },
			message: "PlanetScale doesn't host SQLite, so pick Turso.",
		},
		{
			config: { database: "MySQL", databaseProvider: "Neon" },
			flags: { database: "MySQL", "database-provider": "Neon" },
			message: "Neon doesn't host MySQL, so pick PlanetScale.",
		},
		{
			config: { catalogs: "flat", packageManager: "npm" },
			flags: { catalogs: "flat", "package-manager": "npm" },
			message: "pnpm Catalogs need pnpm.",
		},
		{
			config: { catalogs: "scoped", packageManager: "Yarn" },
			flags: { catalogs: "scoped", "package-manager": "Yarn" },
			message: "pnpm Catalogs need pnpm.",
		},
		{
			config: { catalogs: "flat", packageManager: "Bun" },
			flags: { catalogs: "flat", "package-manager": "Bun" },
			message: "pnpm Catalogs need pnpm.",
		},
		{
			config: { desktop: "electron" },
			flags: { desktop: "electron" },
			message: "We don't support Desktop yet.",
		},
	])("refuses dropped values: $message", async ({ config, flags, message }) => {
		await withTempDir("create-dropped-values", async (directory) => {
			const configPath = join(directory, "forge.config.json");
			await writeFile(configPath, JSON.stringify(config));
			const exit = vi.spyOn(process, "exit").mockImplementation((code) => {
				throw new Error(`exit:${code ?? 0}`);
			});

			try {
				await expect(runCreate({ config: configPath })).rejects.toThrow(
					"exit:1",
				);

				await expect(runCreate(flags)).rejects.toThrow("exit:1");

				expect(promptMocks.logError.mock.calls).toEqual([[message], [message]]);
				expect(orchestratorMocks.orchestrate).not.toHaveBeenCalled();
			} finally {
				exit.mockRestore();
			}
		});
	});

	it.each([
		{ orm: "prisma", databaseProvider: "nile" },
		{ orm: "drizzle", databaseProvider: "prisma-postgres" },
	])("keeps $orm with $databaseProvider", async ({ orm, databaseProvider }) => {
		await withTempDir("create-valid-providers", async (directory) => {
			const configPath = join(directory, "forge.config.json");
			await writeFile(
				configPath,
				JSON.stringify({ database: "postgresql", orm, databaseProvider }),
			);

			await runCreate({ config: configPath });
			await runCreate({
				database: "postgresql",
				orm,
				"database-provider": databaseProvider,
			});

			expect(orchestratorMocks.orchestrate).toHaveBeenCalledTimes(2);

			for (const [, invocation] of orchestratorMocks.orchestrate.mock.calls)
				expect(invocation.initialConfig).toMatchObject({
					database: "postgresql",
					orm,
					databaseProvider,
				});

			expect(promptMocks.logError).not.toHaveBeenCalled();
		});
	});

	it("lets the database prompt follow a lone provider flag", async () => {
		await runCreate({ "database-provider": "neon" });

		expect(orchestratorMocks.orchestrate).toHaveBeenCalledWith(steps, {
			initialConfig: { databaseProvider: "neon" },
			interactive: true,
		});

		expect(promptMocks.logError).not.toHaveBeenCalled();
	});

	it("checks dropped values after merging presets and flag overrides", async () => {
		await withTempDir("create-merged-validation", async (directory) => {
			const configPath = join(directory, "forge.config.json");
			await writeFile(
				configPath,
				JSON.stringify({
					database: "sqlite",
					databaseProvider: "neon",
					packageManager: "npm",
					catalogs: "flat",
				}),
			);

			await runCreate({
				config: configPath,
				database: "postgresql",
				"package-manager": "pnpm",
			});

			await runCreate({ preset: "default", "database-provider": "neon" });

			expect(orchestratorMocks.orchestrate).toHaveBeenCalledTimes(2);
			expect(promptMocks.logError).not.toHaveBeenCalled();
		});
	});

	it("merges presets, config files, and flag overrides before orchestration", async () => {
		await withTempDir("create-test", async (directory) => {
			const configPath = join(directory, "forge.config.json");

			await writeFile(
				configPath,
				JSON.stringify({
					name: "From Config",
					path: "./from-config",
					web: "tanstack-router",
				}),
				"utf-8",
			);

			await runCreate({
				config: configPath,
				name: "From Flag",
				"no-git": true,
				"no-install": true,
				preset: "default",
				runtime: "Bun",
			});

			expect(orchestratorMocks.orchestrate).toHaveBeenCalledWith(steps, {
				initialConfig: {
					...defaultPreset,
					gitInit: false,
					installDeps: false,
					name: "From Flag",
					path: "./from-config",
					runtime: "Bun",
					web: "tanstack-router",
				},
				interactive: false,
			});
		});
	});

	it("passes the preset through untouched and stays interactive without a config file", async () => {
		await runCreate({ preset: "default" });

		expect(orchestratorMocks.orchestrate).toHaveBeenCalledWith(steps, {
			initialConfig: { ...defaultPreset },
			interactive: true,
		});
	});

	it("keeps gitInit and installDeps from the config file when the flags are absent", async () => {
		await withTempDir("create-test", async (directory) => {
			const configPath = join(directory, "forge.config.json");

			await writeFile(
				configPath,
				JSON.stringify({ gitInit: true, installDeps: true }),
				"utf-8",
			);

			await runCreate({ config: configPath });

			expect(orchestratorMocks.orchestrate).toHaveBeenCalledWith(steps, {
				initialConfig: { gitInit: true, installDeps: true },
				interactive: false,
			});
		});
	});

	it("passes TanStack Start through from a config file", async () => {
		await withTempDir("create-tanstack-start", async (directory) => {
			const configPath = join(directory, "forge.config.json");

			await writeFile(
				configPath,
				JSON.stringify({
					name: "Acme",
					web: "tanstack-start",
				}),
				"utf-8",
			);

			await runCreate({ config: configPath });

			expect(orchestratorMocks.orchestrate).toHaveBeenCalledWith(steps, {
				initialConfig: {
					name: "Acme",
					web: "tanstack-start",
				},
				interactive: false,
			});
		});
	});

	it("passes React Router through from a config file", async () => {
		await withTempDir("create-react-router", async (directory) => {
			const configPath = join(directory, "forge.config.json");

			await writeFile(
				configPath,
				JSON.stringify({ name: "Acme", web: "react-router" }),
				"utf-8",
			);

			await runCreate({ config: configPath });

			expect(orchestratorMocks.orchestrate).toHaveBeenCalledWith(steps, {
				initialConfig: { name: "Acme", web: "react-router" },
				interactive: false,
			});
		});
	});

	it.each([
		{ web: "react-router", route: "app/routes/api.orpc.$.ts" },
		{ web: "tanstack-start", route: "src/routes/api/orpc/$.ts" },
	] satisfies ReadonlyArray<{ web: ForgeConfig["web"]; route: string }>)(
		"plans the primary $web oRPC slot in the create manifest",
		async ({ web, route }) => {
			await withTempDir("create-orpc", async (directory) => {
				const config: ForgeConfig = {
					slug: "acme",
					web,
					backend: "self",
					rpc: "orpc",
					packageManager: "pnpm",
				};

				const layer = CoreLive.pipe(
					Layer.provide(
						Layer.succeed(CliVersion, { version: "test-cli-version" }),
					),
					Layer.provideMerge(NodeServices.layer),
				);

				const plan = await Effect.runPromise(
					Effect.gen(function* () {
						const versions = yield* probeWorkspaceCommandVersions(config);
						const planner = yield* Planner;
						return yield* planner.planCreate(
							directory,
							config,
							builtins,
							versions,
						);
					}).pipe(Effect.provide(layer)),
				);

				expect(
					Object.values(plan.manifest.modules).find(
						(module) => module.root === "apps/web",
					),
				).toMatchObject({
					definitionIds: [`${web}/base`],
				});

				const moduleManifest = plan.writes.find(
					(write) => write.path === "apps/web/forge.json",
				);

				if (moduleManifest === undefined)
					throw new Error("Missing Module Manifest: apps/web");

				expect(JSON.parse(moduleManifest.content)).toMatchObject({
					framework: web,
					slots: { orpc: route },
				});
			});
		},
	);

	it("logs a helpful error when the preset is unknown", async () => {
		const exit = vi.spyOn(process, "exit").mockImplementation(((
			code?: string | number | null,
		) => {
			throw new Error(`exit:${code ?? 0}`);
		}) as never);

		try {
			await expect(runCreate({ preset: "unknown" })).rejects.toThrow("exit:1");

			expect(promptMocks.logError).toHaveBeenCalledWith(
				"We couldn't find this preset. You can use: default.",
			);

			expect(orchestratorMocks.orchestrate).not.toHaveBeenCalled();
		} finally {
			exit.mockRestore();
		}
	});

	it("logs a helpful error when the config file cannot be parsed", async () => {
		await withTempDir("create-test", async (directory) => {
			const configPath = join(directory, "broken.json");
			const exit = vi.spyOn(process, "exit").mockImplementation(((
				code?: string | number | null,
			) => {
				throw new Error(`exit:${code ?? 0}`);
			}) as never);

			try {
				await writeFile(configPath, "{invalid-json", "utf-8");

				await expect(runCreate({ config: configPath })).rejects.toThrow(
					"exit:1",
				);

				expect(promptMocks.logError).toHaveBeenCalledWith(
					`We couldn't read or parse the config file at "${configPath}".`,
				);

				expect(orchestratorMocks.orchestrate).not.toHaveBeenCalled();
			} finally {
				exit.mockRestore();
			}
		});
	});

	it("logs a helpful error when the config file does not exist", async () => {
		await withTempDir("create-test", async (directory) => {
			const configPath = join(directory, "missing.json");
			const exit = vi.spyOn(process, "exit").mockImplementation(((
				code?: string | number | null,
			) => {
				throw new Error(`exit:${code ?? 0}`);
			}) as never);

			try {
				await expect(runCreate({ config: configPath })).rejects.toThrow(
					"exit:1",
				);

				expect(promptMocks.logError).toHaveBeenCalledWith(
					`We couldn't read or parse the config file at "${configPath}".`,
				);

				expect(orchestratorMocks.orchestrate).not.toHaveBeenCalled();
			} finally {
				exit.mockRestore();
			}
		});
	});

	it("refuses a config file web app named after an addon id", async () => {
		await withTempDir("create-test", async (directory) => {
			const configPath = join(directory, "forge.config.json");
			const exit = vi.spyOn(process, "exit").mockImplementation((code) => {
				throw new Error(`exit:${code ?? 0}`);
			});

			try {
				await writeFile(
					configPath,
					JSON.stringify({
						web: "nextjs",
						webApps: [{ name: "biome", framework: "nextjs" }],
					}),
					"utf-8",
				);

				await expect(runCreate({ config: configPath })).rejects.toThrow(
					"exit:1",
				);

				expect(promptMocks.logError).toHaveBeenCalledWith(
					"biome is an addon id. Pick another name for this web app.",
				);

				expect(orchestratorMocks.orchestrate).not.toHaveBeenCalled();
			} finally {
				exit.mockRestore();
			}
		});
	});

	it("rejects config files that parse but are not a record", async () => {
		await withTempDir("create-test", async (directory) => {
			const configPath = join(directory, "invalid.json");
			const exit = vi.spyOn(process, "exit").mockImplementation(((
				code?: string | number | null,
			) => {
				throw new Error(`exit:${code ?? 0}`);
			}) as never);

			try {
				await writeFile(configPath, "[1,2]", "utf-8");

				await expect(runCreate({ config: configPath })).rejects.toThrow(
					"exit:1",
				);

				expect(promptMocks.logError).toHaveBeenCalledWith(
					"Your config file is invalid.\n  Expected { readonly [x: string]: unknown }, actual [1,2]",
				);

				expect(orchestratorMocks.orchestrate).not.toHaveBeenCalled();
			} finally {
				exit.mockRestore();
			}
		});
	});
});
