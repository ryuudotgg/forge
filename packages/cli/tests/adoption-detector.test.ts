import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { FileSystem, Error as PlatformError } from "@effect/platform";
import { NodeContext } from "@effect/platform-node";
import { Cause, Effect, Exit, Layer, Option } from "effect";
import { describe, expect, it } from "vitest";
import {
	AdoptionDetector,
	AdoptionFileParseError,
	AdoptionFileReadError,
} from "../src/commands/adoption";

const detectorLayer = AdoptionDetector.Default.pipe(
	Layer.provide(NodeContext.layer),
);

const fileSystemFailures: ReadonlyArray<{
	readonly fail: (
		method: string,
		path: string,
	) => PlatformError.BadArgument | PlatformError.SystemError;
	readonly detail: string;
	readonly name: string;
}> = [
	{
		detail: "Fixture bad argument",
		fail: (method) =>
			new PlatformError.BadArgument({
				description: "Fixture bad argument",
				method,
				module: "FileSystem",
			}),
		name: "bad-argument",
	},
	{
		detail: "PermissionDenied",
		fail: (method, path) =>
			new PlatformError.SystemError({
				method,
				module: "FileSystem",
				pathOrDescriptor: path,
				reason: "PermissionDenied",
			}),
		name: "system",
	},
];

function detectorLayerWithFileSystem(
	transform: (fileSystem: FileSystem.FileSystem) => FileSystem.FileSystem,
) {
	const fileSystemLayer = Layer.effect(
		FileSystem.FileSystem,
		Effect.map(FileSystem.FileSystem, transform),
	).pipe(Layer.provide(NodeContext.layer));

	return AdoptionDetector.Default.pipe(Layer.provide(fileSystemLayer));
}

function json(value: unknown): string {
	return `${JSON.stringify(value, undefined, 2)}\n`;
}

async function writeFixture(
	root: string,
	files: Readonly<Record<string, string>>,
) {
	for (const [path, content] of Object.entries(files)) {
		const filePath = join(root, path);
		await mkdir(dirname(filePath), { recursive: true });
		await writeFile(filePath, content);
	}
}

async function withFixture<T>(
	name: string,
	files: Readonly<Record<string, string>>,
	run: (root: string) => Promise<T>,
) {
	const root = await mkdtemp(join(tmpdir(), `forge-adoption-${name}-`));
	try {
		await writeFixture(root, files);
		return await run(root);
	} finally {
		await rm(root, { force: true, recursive: true });
	}
}

function detect(root: string) {
	return Effect.runPromise(
		AdoptionDetector.detect(root).pipe(Effect.provide(detectorLayer)),
	);
}

function enumerate(root: string) {
	return Effect.runPromise(
		AdoptionDetector.enumerate(root).pipe(Effect.provide(detectorLayer)),
	);
}

async function parseFailure<A, E>(
	effect: Effect.Effect<A, E, AdoptionDetector>,
	layer = detectorLayer,
): Promise<E> {
	const exit = await Effect.runPromiseExit(effect.pipe(Effect.provide(layer)));
	if (Exit.isSuccess(exit))
		throw new Error("Expected adoption detection to fail");
	const failure = Cause.failureOption(exit.cause);
	if (Option.isNone(failure)) throw new Error("Expected a typed failure");
	return failure.value;
}

describe("AdoptionDetector", () => {
	it.each(fileSystemFailures)(
		"maps $name exists failures to adoption read errors",
		async ({ detail, fail }) => {
			await withFixture("exists-failure", {}, async (root) => {
				const target = join(root, "pnpm-workspace.yaml");
				const layer = detectorLayerWithFileSystem((fileSystem) => ({
					...fileSystem,
					exists: (path) =>
						path === target
							? Effect.fail(fail("exists", path))
							: fileSystem.exists(path),
				}));

				const failure = await parseFailure(
					AdoptionDetector.enumerate(root),
					layer,
				);
				expect(failure).toBeInstanceOf(AdoptionFileReadError);
				expect(failure).toMatchObject({
					filePath: target,
					message: `Adoption File Read Failed: ${target}`,
				});
				expect(failure.detail).toContain(detail);
			});
		},
	);

	it.each(fileSystemFailures)(
		"maps $name file-read failures to adoption read errors",
		async ({ detail, fail }) => {
			await withFixture(
				"file-read-failure",
				{ "package.json": json({ private: true }) },
				async (root) => {
					const target = join(root, "package.json");
					const layer = detectorLayerWithFileSystem((fileSystem) => ({
						...fileSystem,
						readFileString: (path, encoding) =>
							path === target
								? Effect.fail(fail("readFileString", path))
								: fileSystem.readFileString(path, encoding),
					}));

					const failure = await parseFailure(
						AdoptionDetector.enumerate(root),
						layer,
					);
					expect(failure).toBeInstanceOf(AdoptionFileReadError);
					expect(failure).toMatchObject({
						filePath: target,
						message: `Adoption File Read Failed: ${target}`,
					});
					expect(failure.detail).toContain(detail);
				},
			);
		},
	);

	it.each(fileSystemFailures)(
		"maps $name workspace-scan failures to adoption read errors",
		async ({ detail, fail }) => {
			await withFixture(
				"workspace-scan-failure",
				{ "package.json": json({ workspaces: ["apps/*"] }) },
				async (root) => {
					const layer = detectorLayerWithFileSystem((fileSystem) => ({
						...fileSystem,
						readDirectory: (path, options) =>
							path === root
								? Effect.fail(fail("readDirectory", path))
								: fileSystem.readDirectory(path, options),
					}));

					const failure = await parseFailure(
						AdoptionDetector.enumerate(root),
						layer,
					);
					expect(failure).toBeInstanceOf(AdoptionFileReadError);
					expect(failure).toMatchObject({
						filePath: root,
						message: `Adoption Directory Read Failed: ${root}`,
					});
					expect(failure.detail).toContain(detail);
				},
			);
		},
	);

	it.each(fileSystemFailures)(
		"skips workspace directories with $name stat failures",
		async ({ fail }) => {
			await withFixture(
				"stat-failure",
				{
					"apps/web/package.json": json({ dependencies: { next: "^16" } }),
					"package.json": json({ workspaces: ["apps/*"] }),
				},
				async (root) => {
					const target = join(root, "apps");
					const layer = detectorLayerWithFileSystem((fileSystem) => ({
						...fileSystem,
						stat: (path) =>
							path === target
								? Effect.fail(fail("stat", path))
								: fileSystem.stat(path),
					}));

					const roots = await Effect.runPromise(
						AdoptionDetector.enumerate(root).pipe(Effect.provide(layer)),
					);
					expect(roots).toEqual([]);
				},
			);
		},
	);

	it.each(fileSystemFailures)(
		"skips workspace directories with $name real-path failures",
		async ({ fail }) => {
			await withFixture(
				"real-path-failure",
				{
					"apps/web/package.json": json({ dependencies: { next: "^16" } }),
					"package.json": json({ workspaces: ["apps/*"] }),
				},
				async (root) => {
					const target = join(root, "apps");
					const layer = detectorLayerWithFileSystem((fileSystem) => ({
						...fileSystem,
						realPath: (path) =>
							path === target
								? Effect.fail(fail("realPath", path))
								: fileSystem.realPath(path),
					}));

					const roots = await Effect.runPromise(
						AdoptionDetector.enumerate(root).pipe(Effect.provide(layer)),
					);
					expect(roots).toEqual([]);
				},
			);
		},
	);

	it.each(fileSystemFailures)(
		"maps $name project real-path failures to adoption read errors",
		async ({ detail, fail }) => {
			await withFixture(
				"project-real-path-failure",
				{ "package.json": json({ workspaces: ["apps/*"] }) },
				async (root) => {
					const layer = detectorLayerWithFileSystem((fileSystem) => ({
						...fileSystem,
						realPath: (path) =>
							path === root
								? Effect.fail(fail("realPath", path))
								: fileSystem.realPath(path),
					}));

					const failure = await parseFailure(
						AdoptionDetector.enumerate(root),
						layer,
					);
					expect(failure).toBeInstanceOf(AdoptionFileReadError);
					expect(failure).toMatchObject({
						filePath: root,
						message: `Adoption Directory Read Failed: ${root}`,
					});
					expect(failure.detail).toContain(detail);
				},
			);
		},
	);

	it.each(fileSystemFailures)(
		"maps $name root-directory failures to adoption read errors",
		async ({ detail, fail }) => {
			await withFixture("root-directory-failure", {}, async (root) => {
				const layer = detectorLayerWithFileSystem((fileSystem) => ({
					...fileSystem,
					readDirectory: (path, options) =>
						path === root
							? Effect.fail(fail("readDirectory", path))
							: fileSystem.readDirectory(path, options),
				}));

				const failure = await parseFailure(
					AdoptionDetector.detect(root),
					layer,
				);
				expect(failure).toBeInstanceOf(AdoptionFileReadError);
				expect(failure).toMatchObject({
					filePath: root,
					message: `Adoption Directory Read Failed: ${root}`,
				});
				expect(failure.detail).toContain(detail);
			});
		},
	);

	it("detects and maps an ajito-like pnpm workspace", async () => {
		await withFixture(
			"ajito",
			{
				".env.example": "NEON_DATABASE_URL=\n",
				".nvmrc": "24\n",
				"apps/admin/package.json": json({ dependencies: { next: "catalog:" } }),
				"apps/web/package.json": json({
					dependencies: { "@acme/ui": "workspace:*", next: "catalog:" },
				}),
				"biome.json": "{}\n",
				"commitlint.config.ts": "export default {};\n",
				"lefthook.yml": "pre-commit: {}\n",
				"package.json": json({
					engines: { node: ">=24", pnpm: ">=10" },
					private: true,
				}),
				"packages/auth/package.json": json({
					dependencies: { "better-auth": "catalog:" },
				}),
				"packages/db/package.json": json({
					dependencies: {
						"@neondatabase/serverless": "catalog:",
						"drizzle-orm": "catalog:",
					},
				}),
				"packages/i18n/package.json": json({
					dependencies: { i18next: "^25" },
				}),
				"packages/shared/package.json": json({
					dependencies: { remeda: "^2" },
				}),
				"packages/trpc/package.json": json({
					dependencies: { "@trpc/server": "catalog:" },
				}),
				"packages/ui/components.json": json({ style: "base-nova" }),
				"packages/ui/package.json": json({
					dependencies: { "@base-ui/react": "catalog:" },
					devDependencies: { tailwindcss: "catalog:" },
				}),
				"pnpm-lock.yaml": "lockfileVersion: '9.0'\n",
				"pnpm-workspace.yaml": [
					"packages:",
					'  - "apps/*"',
					'  - "packages/*"',
					"",
					"catalog:",
					"  next: ^16.0.0",
					'  "@neondatabase/serverless": ^1.0.2',
					"  drizzle-orm: 1.0.0-rc.4",
					"  better-auth: ^1.4.0",
					'  "@trpc/server": ^11.7.1',
					'  "@base-ui/react": ^1.5.0',
					"  tailwindcss: ^4.1.0",
					"",
				].join("\n"),
				"turbo.json": "{}\n",
				"vitest.config.ts": "export default {};\n",
			},
			async (root) => {
				const result = await detect(root);

				expect(result.config).toEqual({
					addons: ["commitlint", "lefthook", "vitest"],
					authentication: "better-auth",
					catalogs: "flat",
					database: "postgresql",
					databaseProvider: "neon",
					linter: "biome",
					orm: "drizzle",
					packageManager: "pnpm",
					platforms: ["web"],
					rpc: "trpc",
					runtime: "Node.js",
					style: "tailwind",
					uiLibrary: "base-ui",
					web: "nextjs",
				});
				expect(result.tooling).toEqual({ turbo: true });
				expect(result.modules).toEqual([
					{
						evidence: "found next in its dependencies",
						proposal: "web-app",
						root: "apps/admin",
					},
					{
						evidence: "found next in its dependencies",
						proposal: "web-app",
						root: "apps/web",
					},
					{
						evidence: "found better-auth in its dependencies",
						proposal: "auth",
						root: "packages/auth",
					},
					{
						evidence: "found drizzle-orm in its dependencies",
						proposal: "db",
						root: "packages/db",
					},
					{
						evidence: "found no known adoption signature",
						proposal: "unadopted",
						root: "packages/i18n",
					},
					{
						evidence: "found no known adoption signature",
						proposal: "unadopted",
						root: "packages/shared",
					},
					{
						evidence: "found @trpc/server in its dependencies",
						proposal: "trpc",
						root: "packages/trpc",
					},
					{
						evidence:
							"found @base-ui/react in its dependencies; also found components.json in the module",
						proposal: "ui",
						root: "packages/ui",
					},
				]);
				const dbVersions = result.versions.find(
					(entry) => entry.root === "packages/db",
				);
				expect(dbVersions?.dependencies).toContainEqual({
					name: "drizzle-orm",
					section: "dependencies",
					specifier: "catalog:",
					version: "1.0.0-rc.4",
				});
				expect(result.versions.map((entry) => entry.root)).not.toContain(
					"packages/shared",
				);
			},
		);
	});

	it("treats a settings-only pnpm workspace as authoritative", async () => {
		await withFixture(
			"settings-only-pnpm",
			{
				"apps/web/package.json": json({ dependencies: { next: "^16" } }),
				"package.json": json({
					engines: { node: ">=24" },
					workspaces: ["apps/*"],
				}),
				"pnpm-lock.yaml": "lockfileVersion: '9.0'\n",
				"pnpm-workspace.yaml": "onlyBuiltDependencies:\n  - esbuild\n",
				"turbo.json": "{}\n",
			},
			async (root) => {
				const result = await detect(root);
				expect(result.config).toEqual({
					packageManager: "pnpm",
					runtime: "Node.js",
				});
				expect(result.modules).toEqual([]);
				expect(result.tooling).toEqual({ turbo: true });
			},
		);
	});

	it("parses catalogs indented with four spaces", async () => {
		await withFixture(
			"four-space-catalog",
			{
				"apps/web/package.json": json({
					dependencies: { next: "catalog:framework" },
				}),
				"package.json": json({ private: true }),
				"pnpm-workspace.yaml": [
					"packages:",
					"    - apps/*",
					"catalogs:",
					"    framework:",
					"        next: ^16.0.0",
					"",
				].join("\n"),
			},
			async (root) => {
				const result = await detect(root);
				expect(result.catalogEntries).toEqual([
					{ catalog: "framework", name: "next", version: "^16.0.0" },
				]);
				expect(result.versions[0]?.dependencies[0]?.version).toBe("^16.0.0");
			},
		);
	});

	it("leaves an unresolvable catalog reference without a version", async () => {
		await withFixture(
			"missing-catalog-pin",
			{
				"apps/web/package.json": json({
					dependencies: { next: "catalog:framework" },
				}),
				"pnpm-workspace.yaml": "packages:\n  - apps/*\n",
			},
			async (root) => {
				const result = await detect(root);
				expect(result.versions[0]?.dependencies[0]).toMatchObject({
					name: "next",
					specifier: "catalog:framework",
					version: undefined,
				});
			},
		);
	});

	it("captures scoped catalog pins in a Kingshot-like mixed workspace", async () => {
		const files: Record<string, string> = {
			"apps/api/package.json": json({ dependencies: { hono: "^4" } }),
			"apps/docs/package.json": json({ dependencies: { vite: "^7" } }),
			"apps/mobile/package.json": json({ dependencies: { expo: "^54" } }),
			"apps/web/package.json": json({
				dependencies: { "@tanstack/react-start": "catalog:framework" },
			}),
			"package.json": json({ private: true }),
			"packages/auth/package.json": json({
				dependencies: { "better-auth": "catalog:framework" },
			}),
			"packages/db/package.json": json({
				dependencies: {
					"@prisma/adapter-libsql": "catalog:database",
					"@prisma/client": "catalog:database",
				},
			}),
			"packages/trpc/package.json": json({
				dependencies: { "@trpc/server": "catalog:framework" },
			}),
			"packages/ui/components.json": json({ style: "radix-vega" }),
			"packages/ui/package.json": json({ dependencies: { react: "^19" } }),
			"pnpm-lock.yaml": "lockfileVersion: '9.0'\n",
			"pnpm-workspace.yaml": [
				"packages:",
				"  - apps/* # applications",
				"  - 'packages/*'",
				"catalogs:",
				"  framework:",
				'    "@tanstack/react-start": ^1.130.0',
				"    better-auth: ^1.4.0",
				'    "@trpc/server": ^11.7.1',
				"  database:",
				'    "@prisma/client": 7.8.0',
				'    "@prisma/adapter-libsql": 7.8.0',
				"",
			].join("\n"),
		};
		for (const name of [
			"analytics",
			"config",
			"email",
			"i18n",
			"logger",
			"shared",
			"storage",
		])
			files[`packages/${name}/package.json`] = json({
				dependencies: { nanoid: "^5" },
			});

		await withFixture("kingshot", files, async (root) => {
			const result = await detect(root);
			expect(result.modules).toHaveLength(15);
			expect(
				result.modules.filter((module) => module.proposal === "unadopted"),
			).toHaveLength(10);
			expect(result.config).toMatchObject({
				authentication: "better-auth",
				catalogs: "scoped",
				database: "sqlite",
				orm: "prisma",
				platforms: ["web"],
				rpc: "trpc",
				uiLibrary: "radix",
				web: "tanstack-start",
			});
			expect(result.config).not.toHaveProperty("databaseProvider");
			expect(
				result.versions
					.find((entry) => entry.root === "packages/db")
					?.dependencies.find((entry) => entry.name === "@prisma/client"),
			).toEqual({
				name: "@prisma/client",
				section: "dependencies",
				specifier: "catalog:database",
				version: "7.8.0",
			});
		});
	});

	it.each([
		{
			lockfile: "package-lock.json",
			manager: "npm",
			name: "npm",
			workspaces: ["apps/*"],
		},
		{
			lockfile: "yarn.lock",
			manager: "Yarn",
			name: "yarn Berry",
			workspaces: { packages: ["apps/*"] },
		},
		{
			lockfile: "bun.lock",
			manager: "Bun",
			name: "bun",
			workspaces: ["apps/*"],
		},
	])("enumerates $name package.json workspaces", async (cell) => {
		await withFixture(
			cell.name,
			{
				"apps/private/package.json": json({ private: true }),
				"apps/web/package.json": json({ dependencies: { next: "^16" } }),
				[cell.lockfile]: "",
				"package.json": json({ private: true, workspaces: cell.workspaces }),
			},
			async (root) => {
				expect(await enumerate(root)).toEqual(["apps/private", "apps/web"]);
				expect((await detect(root)).config.packageManager).toBe(cell.manager);
			},
		);
	});

	it("honors recursive and excluded workspace globs", async () => {
		await withFixture(
			"globs",
			{
				"apps/nested/admin/package.json": json({
					dependencies: { next: "^16" },
				}),
				"apps/private/package.json": json({ dependencies: { next: "^16" } }),
				"apps/web.v2/package.json": json({ dependencies: { next: "^16" } }),
				"package.json": json({
					workspaces: [
						"apps/**",
						"apps/web.v2",
						"!apps/privat?",
						"",
						"/outside/*",
						"../outside/*",
					],
				}),
			},
			async (root) => {
				expect(await enumerate(root)).toEqual([
					"apps/nested/admin",
					"apps/web.v2",
				]);
			},
		);
	});

	it("accepts zero-indent workspace sequence items", async () => {
		await withFixture(
			"zero-indent-sequence",
			{
				"apps/web/package.json": json({ dependencies: { next: "^16" } }),
				"pnpm-workspace.yaml": "packages:\n- apps/*\n",
			},
			async (root) => {
				expect(await enumerate(root)).toEqual(["apps/web"]);
			},
		);
	});

	it("expands braces in workspace globs", async () => {
		await withFixture(
			"brace-glob",
			{
				"apps/web/package.json": json({}),
				"package.json": json({ workspaces: ["{apps,packages}/*"] }),
				"packages/db/package.json": json({}),
			},
			async (root) => {
				expect(await enumerate(root)).toEqual(["apps/web", "packages/db"]);
			},
		);
	});

	it("ignores malformed brace workspace globs", async () => {
		await withFixture(
			"malformed-brace-globs",
			{
				"apps/web/package.json": json({}),
				"package.json": json({
					workspaces: ["apps/{nested", "apps/{one}", "apps/{,two}"],
				}),
			},
			async (root) => {
				expect(await enumerate(root)).toEqual([]);
			},
		);
	});

	it("matches a zero-segment workspace globstar", async () => {
		await withFixture(
			"zero-segment-globstar",
			{
				"apps/web/package.json": json({}),
				"package.json": json({ workspaces: ["apps/**/web"] }),
			},
			async (root) => {
				expect(await enumerate(root)).toEqual(["apps/web"]);
			},
		);
	});

	it("skips workspace symlinks that escape the project root", async () => {
		await withFixture(
			"symlink-escape",
			{ "package.json": json({ workspaces: ["apps/*"] }) },
			async (root) => {
				const outside = await mkdtemp(
					join(tmpdir(), "forge-adoption-outside-"),
				);
				try {
					const linkedPackage = join(root, "apps/link/package.json");
					await writeFixture(outside, {
						"package.json": json({ dependencies: { next: "^16" } }),
					});
					await mkdir(join(root, "apps"), { recursive: true });
					await symlink(outside, join(root, "apps/link"), "dir");
					const link = join(root, "apps/link");
					const reads: string[] = [];
					const stats: string[] = [];
					const layer = detectorLayerWithFileSystem((fileSystem) => ({
						...fileSystem,
						readFileString: (path, encoding) => {
							if (path === linkedPackage) reads.push(path);
							return fileSystem.readFileString(path, encoding);
						},
						stat: (path) => {
							if (path === link) stats.push(path);
							return fileSystem.stat(path);
						},
					}));

					expect(
						await Effect.runPromise(
							AdoptionDetector.enumerate(root).pipe(Effect.provide(layer)),
						),
					).toEqual([]);
					const result = await Effect.runPromise(
						AdoptionDetector.detect(root).pipe(Effect.provide(layer)),
					);
					expect(result.modules).toEqual([]);
					expect(stats).toEqual([]);
					expect(reads).toEqual([]);
				} finally {
					await rm(outside, { force: true, recursive: true });
				}
			},
		);
	});

	it("ignores generated package directories", async () => {
		await withFixture(
			"ignored-generated-directories",
			{
				".output/app/package.json": json({}),
				".pnpm-store/app/package.json": json({}),
				".vercel/app/package.json": json({}),
				"package.json": json({
					workspaces: [".output/*", ".pnpm-store/*", ".vercel/*"],
				}),
			},
			async (root) => {
				expect(await enumerate(root)).toEqual([]);
			},
		);
	});

	it("reads adoption files once during detection", async () => {
		await withFixture(
			"single-pass",
			{
				"apps/web/package.json": json({ dependencies: { next: "^16" } }),
				"package.json": json({ private: true }),
				"pnpm-workspace.yaml": "packages:\n  - apps/*\n",
			},
			async (root) => {
				const counts = new Map<string, number>();
				const layer = detectorLayerWithFileSystem((fileSystem) => ({
					...fileSystem,
					readFileString: (path, encoding) => {
						counts.set(path, (counts.get(path) ?? 0) + 1);
						return fileSystem.readFileString(path, encoding);
					},
				}));

				await Effect.runPromise(
					AdoptionDetector.detect(root).pipe(Effect.provide(layer)),
				);
				expect(counts.get(join(root, "pnpm-workspace.yaml"))).toBe(1);
				expect(counts.get(join(root, "package.json"))).toBe(1);
				expect(counts.get(join(root, "apps/web/package.json"))).toBe(1);
			},
		);
	});

	it("leaves ambiguous and absent signals undefined", async () => {
		await withFixture(
			"ambiguous",
			{
				".eslintrc.json": "{}\n",
				"apps/mixed/package.json": json({
					dependencies: { "@tanstack/react-start": "^1", next: "^16" },
				}),
				"biome.json": "{}\n",
				"bun.lockb": "",
				"package-lock.json": "",
				"package.json": json({ workspaces: ["apps/*", "packages/*"] }),
				"packages/db/package.json": json({ dependencies: { pg: "^8" } }),
			},
			async (root) => {
				const result = await detect(root);
				expect(result.config).toEqual({
					database: "postgresql",
					linter: "biome",
				});
				expect(result.tooling).toEqual({});
				expect(
					result.modules.find((module) => module.root === "packages/db"),
				).toEqual({
					evidence: "found no known adoption signature",
					proposal: "unadopted",
					root: "packages/db",
				});
			},
		);
	});

	it.each([
		{
			database: "mysql",
			dependency: "@planetscale/database",
			envName: undefined,
			provider: "planetscale",
		},
		{
			database: "postgresql",
			dependency: "@prisma/adapter-neon",
			envName: undefined,
			provider: "neon",
		},
		{
			database: "postgresql",
			dependency: "pg",
			envName: "NILE_DATABASE_URL",
			provider: "nile",
		},
		{
			database: "postgresql",
			dependency: "postgres",
			envName: "SUPABASE_DB_URL",
			provider: "supabase",
		},
		{
			database: "postgresql",
			dependency: "pg",
			envName: "PRISMA_POSTGRES_URL",
			provider: "prisma-postgres",
		},
		{
			database: "sqlite",
			dependency: "@libsql/client",
			envName: "TURSO_DATABASE_URL",
			provider: "turso",
		},
	])("detects the $provider database provider", async (cell) => {
		await withFixture(
			cell.provider,
			{
				...(cell.envName === undefined
					? {}
					: { ".env.example": `${cell.envName}=\n` }),
				"package.json": json({ workspaces: ["packages/*"] }),
				"packages/data/package.json": json({
					dependencies: { [cell.dependency]: "1.0.0", "drizzle-orm": "1.0.0" },
				}),
			},
			async (root) => {
				expect((await detect(root)).config).toMatchObject({
					database: cell.database,
					databaseProvider: cell.provider,
					orm: "drizzle",
				});
			},
		);
	});

	it("drops a database provider that conflicts with the detected database", async () => {
		await withFixture(
			"provider-mismatch",
			{
				".env.example": "NEON_DATABASE_URL=\n",
				"package.json": json({ workspaces: ["packages/*"] }),
				"packages/data/package.json": json({
					dependencies: { "@libsql/client": "^0.15", "drizzle-orm": "^1" },
				}),
			},
			async (root) => {
				const config = (await detect(root)).config;
				expect(config.database).toBe("sqlite");
				expect(config).not.toHaveProperty("databaseProvider");
			},
		);
	});

	it.each([
		{ engine: "bun", runtime: "Bun" },
		{ engine: "deno", runtime: "Deno" },
	])("detects the $runtime runtime from engines", async (cell) => {
		await withFixture(
			cell.engine,
			{
				"eslint.config.js": "export default [];\n",
				"package.json": json({ engines: { [cell.engine]: ">=1" } }),
			},
			async (root) => {
				const result = await detect(root);
				expect(result.config.runtime).toBe(cell.runtime);
				expect(result.config).not.toHaveProperty("linter");
			},
		);
	});

	it("leaves dual node and bun runtime engines undefined", async () => {
		await withFixture(
			"dual-runtime",
			{ "package.json": json({ engines: { bun: ">=1", node: ">=24" } }) },
			async (root) => {
				expect((await detect(root)).config).not.toHaveProperty("runtime");
			},
		);
	});

	it("maps UI from components.json and never from a directory name", async () => {
		await withFixture(
			"signatures",
			{
				"package.json": json({ workspaces: ["packages/*"] }),
				"packages/db/package.json": json({ dependencies: { nanoid: "^5" } }),
				"packages/design/components.json": json({}),
				"packages/design/package.json": json({
					dependencies: { react: "^19" },
				}),
			},
			async (root) => {
				const result = await detect(root);
				expect(result.modules).toEqual([
					{
						evidence: "found no known adoption signature",
						proposal: "unadopted",
						root: "packages/db",
					},
					{
						evidence: "found components.json in the module",
						proposal: "ui",
						root: "packages/design",
					},
				]);
			},
		);
	});

	it("detects React Router from a direct web dependency", async () => {
		await withFixture(
			"react-router",
			{
				"apps/web/.react-router/generated/package.json": json({
					dependencies: { next: "^16" },
				}),
				"apps/web/package.json": json({
					dependencies: { "react-router": "8.3.0" },
				}),
				"package.json": json({ workspaces: ["apps/*"] }),
			},
			async (root) => {
				const result = await detect(root);
				expect(result.config).toMatchObject({
					platforms: ["web"],
					web: "react-router",
				});
				expect(result.modules).toEqual([
					{
						evidence: "found react-router in its dependencies",
						proposal: "web-app",
						root: "apps/web",
					},
				]);
			},
		);
	});

	it("keeps the first module signature and reports the others", async () => {
		await withFixture(
			"multi-signature",
			{
				"apps/mixed/components.json": json({}),
				"apps/mixed/package.json": json({
					dependencies: { "drizzle-orm": "^1", next: "^16" },
				}),
				"package.json": json({ workspaces: ["apps/*"] }),
			},
			async (root) => {
				expect((await detect(root)).modules[0]).toEqual({
					evidence:
						"found next in its dependencies; also found drizzle-orm in its dependencies; also found components.json in the module",
					proposal: "web-app",
					root: "apps/mixed",
				});
			},
		);
	});

	it.each([
		{ file: "pnpm-workspace.yaml", name: "empty workspace", value: "" },
		{
			file: "pnpm-workspace.yaml",
			name: "inline workspace",
			value: "packages: [\n",
		},
		{
			file: "pnpm-workspace.yaml",
			name: "flow-style workspace",
			value: 'packages: ["apps/*"]\n',
		},
		{
			file: "pnpm-workspace.yaml",
			name: "tabbed workspace",
			value: "packages:\n\t- apps/*\n",
		},
		{
			file: "pnpm-workspace.yaml",
			name: "unterminated double quote",
			value: 'packages:\n  - "apps/*\n',
		},
		{
			file: "pnpm-workspace.yaml",
			name: "invalid double quote",
			value: 'packages:\n  - "apps/\\q"\n',
		},
		{
			file: "pnpm-workspace.yaml",
			name: "unterminated single quote",
			value: "packages:\n  - 'apps/*\n",
		},
		{
			file: "pnpm-workspace.yaml",
			name: "invalid top-level entry",
			value: "packages:\n  - apps/*\ngarbage\n",
		},
		{
			file: "pnpm-workspace.yaml",
			name: "invalid package entry",
			value: "packages:\n  apps/*\n",
		},
		{
			file: "pnpm-workspace.yaml",
			name: "invalid catalog entry",
			value: "packages:\n  - apps/*\ncatalog:\n  invalid\n",
		},
		{
			file: "pnpm-workspace.yaml",
			name: "invalid scoped catalog name",
			value: "packages:\n  - apps/*\ncatalogs:\n  :\n",
		},
		{
			file: "pnpm-workspace.yaml",
			name: "invalid scoped catalog entry",
			value: "packages:\n  - apps/*\ncatalogs:\n  tools:\n    invalid\n",
		},
		{
			file: "pnpm-workspace.yaml",
			name: "invalid scoped catalog syntax",
			value: "catalogs:\n  invalid\n",
		},
		{ file: "package.json", name: "malformed package", value: "{" },
	])("returns a typed error for a $name file", async ({ file, value }) => {
		await withFixture("malformed", { [file]: value }, async (root) => {
			const failure = await parseFailure(AdoptionDetector.enumerate(root));
			expect(failure).toBeInstanceOf(AdoptionFileParseError);
			expect(failure.message).toMatch(/^Adoption File Parse Failed:/);
			expect(failure.detail.length).toBeGreaterThan(0);
		});
	});

	it("returns a typed error for malformed components.json", async () => {
		await withFixture(
			"components",
			{
				"package.json": json({ workspaces: ["packages/*"] }),
				"packages/ui/components.json": "{",
				"packages/ui/package.json": json({ dependencies: { react: "^19" } }),
			},
			async (root) => {
				const failure = await parseFailure(AdoptionDetector.detect(root));
				expect(failure).toBeInstanceOf(AdoptionFileParseError);
				expect(failure.filePath).toBe(
					join(root, "packages/ui/components.json"),
				);
			},
		);
	});

	it("returns no modules when no workspace declaration exists", async () => {
		await withFixture(
			"no-workspace",
			{ "package.json": json({ private: true }) },
			async (root) => {
				expect(await enumerate(root)).toEqual([]);
				expect(await detect(root)).toMatchObject({
					catalogEntries: [],
					config: {},
					modules: [],
					tooling: {},
					versions: [],
				});
			},
		);
	});
});
