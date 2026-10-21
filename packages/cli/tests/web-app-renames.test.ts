import { mkdir, rename, symlink } from "node:fs/promises";
import { join } from "node:path";
import { NodeServices } from "@effect/platform-node";
import { type DiscoveredModule, type Manifest, Subprocess } from "@ryuugg/core";
import type { ForgeConfig } from "@ryuugg/generators";
import { Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";
import {
	checkWebAppRenames,
	directoryMoves,
	pairWebAppRenames,
	pendingWebAppRenameIssue,
	renamedModules,
	renameInstallHint,
	renameReport,
	scanRenameReferences,
	type WebAppRename,
	webAppRenameNameIssue,
} from "../src/commands/web-app-renames";
import { appModule, withTempDir, writeText } from "./lifecycle-fixtures";

const layer = Subprocess.Default.pipe(Layer.provideMerge(NodeServices.layer));
if (appModule.type !== "app") throw new Error("Fixture App Missing");

const primary = { ...appModule, role: "primary" } satisfies DiscoveredModule;
const site = {
	...appModule,
	id: "fghij",
	root: "apps/site",
	packageName: "@acme/site",
} satisfies DiscoveredModule;

const records: Manifest["modules"] = {
	abcde: { root: "apps/web", definitionIds: [] },
	fghij: { root: "apps/site", definitionIds: [] },
};

const config: ForgeConfig = {
	slug: "acme",
	web: "nextjs",
	webName: "vault",
	webApps: [{ name: "marketing", framework: "nextjs" }],
};

function pair(
	config: ForgeConfig,
	modules: ReadonlyArray<DiscoveredModule>,
	manifestRecords = records,
): ReadonlyArray<WebAppRename> {
	const result = pairWebAppRenames(config, modules, manifestRecords);
	if ("message" in result) throw new Error(result.message);
	return result;
}

function git(root: string, args: ReadonlyArray<string>) {
	return Effect.runPromise(
		Subprocess.run({
			command: "git",
			args,
			cwd: root,
			timeoutMs: 10_000,
			outputMode: "capture",
		}).pipe(Effect.provide(layer)),
	);
}

async function committed(root: string) {
	await git(root, ["init", "-q"]);
	await writeText(join(root, ".forge/manifest.json"), "{}\n");
	await writeText(join(root, "README.md"), "project\n");
	await git(root, ["add", "."]);
	await git(root, [
		"-c",
		"user.name=Forge",
		"-c",
		"user.email=forge@example.com",
		"-c",
		"commit.gpgsign=false",
		"-c",
		"core.hooksPath=/dev/null",
		"commit",
		"-qm",
		"fixture",
	]);
}

describe("web app pairing", () => {
	it("refuses a new instance under a vacated root", () => {
		expect(
			pairWebAppRenames(
				{
					...config,
					webApps: [
						{ name: "marketing", framework: "nextjs" },
						{ name: "site", framework: "tanstack-router" },
					],
				},
				[primary, site],
				records,
			),
		).toEqual({
			message: "Rename apps/site first, then add the new site app.",
		});
	});

	it.each([
		{ ...primary, root: "sites/vault", packageName: "@acme/vault" },
		{ ...site, root: "sites/admin", packageName: undefined },
		{ ...primary, packageName: "@acme/vault" },
	])("never renames an adopted app at $root", (module) => {
		const adoptedConfig: ForgeConfig =
			module.id === primary.id
				? {
						slug: "acme",
						web: "nextjs",
						...(module.root === "apps/web" ? { webName: "marketing" } : {}),
					}
				: {
						slug: "acme",
						web: "nextjs",
						webApps: [{ name: "admin", framework: "nextjs" }],
					};

		expect(
			pair(
				adoptedConfig,
				module.id === primary.id ? [module] : [primary, module],
			),
		).toEqual([]);
	});

	it("claims the expected root without scheduling a rename", () => {
		expect(pair({ slug: "acme", web: "nextjs" }, [appModule])).toEqual([]);
	});

	it("claims the package where the user moved it", () => {
		expect(
			pair({ slug: "acme", web: "nextjs" }, [
				{ ...appModule, root: "sites/frontend" },
			]),
		).toEqual([]);
	});

	it("keeps an adopted secondary at its noncanonical root", () => {
		const adopted = {
			...site,
			root: "sites/admin",
			packageName: "legacy-console",
		};

		expect(
			pair(
				{
					slug: "acme",
					web: "nextjs",
					webApps: [{ name: "legacy-console", framework: "nextjs" }],
				},
				[primary, adopted],
				{
					...records,
					fghij: { root: "sites/admin", definitionIds: [] },
				},
			),
		).toEqual([]);
	});

	it("renames a single primary without secondaries or a role", () => {
		expect(
			directoryMoves(
				pair({ slug: "acme", web: "nextjs", webName: "vault" }, [appModule]),
			),
		).toEqual([{ moduleId: "abcde", from: "apps/web", to: "apps/vault" }]);
	});

	it("pairs the primary role before pairing one remaining app", () => {
		expect(directoryMoves(pair(config, [site, primary]))).toEqual([
			{ moduleId: "abcde", from: "apps/web", to: "apps/vault" },
			{ moduleId: "fghij", from: "apps/site", to: "apps/marketing" },
		]);
	});

	it("pairs one remaining instance per framework", () => {
		const other: DiscoveredModule = {
			...site,
			framework: "tanstack-router",
			template: { id: "tanstack-router/base", version: 1 },
		};

		expect(
			pair(
				{
					...config,
					webApps: [{ name: "marketing", framework: "tanstack-router" }],
				},
				[appModule, other],
			),
		).toHaveLength(2);
	});

	it("refuses reuse of the primary root by a secondary", () => {
		const result = pairWebAppRenames(
			{ ...config, webApps: [{ name: "web", framework: "nextjs" }] },
			[primary, site],
			records,
		);

		expect(result).toEqual({
			message: "Rename apps/web first, then add the new web app.",
		});
	});

	it.each([
		{ template: { id: "other", version: 1 } },
		{ template: { id: "nextjs/base", version: 2 } },
		{ framework: "hono" },
	])("does not claim a module with another identity", (identity) => {
		expect(
			pair({ slug: "acme", web: "nextjs", webName: "vault" }, [
				{ ...appModule, ...identity },
			]),
		).toEqual([]);
	});

	it("does not claim modules absent from the manifest", () => {
		expect(pair(config, [primary, site], {})).toEqual([]);
	});

	it("refuses ambiguous same framework secondaries", () => {
		const third = {
			...site,
			id: "klmno",
			root: "apps/docs",
			packageName: "@acme/docs",
		};

		const result = pairWebAppRenames(
			{
				...config,
				webApps: [
					{ name: "marketing", framework: "nextjs" },
					{ name: "help", framework: "nextjs" },
				],
			},
			[primary, site, third],
			{ ...records, klmno: { root: third.root, definitionIds: [] } },
		);

		expect(result).toEqual({
			message:
				"We can't tell which apps to rename from apps/site and apps/docs to apps/marketing and apps/help. Rename one app at a time.",
		});
	});

	it("ignores additions and removals with leftovers on one side only", () => {
		expect(
			pair(
				{
					slug: "acme",
					web: "nextjs",
					webApps: [{ name: "site", framework: "tanstack-router" }],
				},
				[appModule],
			),
		).toEqual([]);

		expect(pair({ slug: "acme", web: "nextjs" }, [primary, site])).toEqual([]);
	});

	it("shares the lifecycle refusal and describes every pending move", () => {
		expect(pendingWebAppRenameIssue(config, [primary, site], records)).toBe(
			"Run forge update first to move apps/web to apps/vault and apps/site to apps/marketing.",
		);

		expect(
			pendingWebAppRenameIssue({ web: "nextjs" }, [appModule], records),
		).toBeUndefined();
	});

	it("renames discovered metadata for warnings and env scans", () => {
		expect(
			renamedModules([primary, site], pair(config, [primary, site])).map(
				(module) => [module.root, module.packageName],
			),
		).toEqual([
			["apps/vault", "@acme/vault"],
			["apps/marketing", "@acme/marketing"],
		]);
	});
});

describe("rename safety and report", () => {
	it("names the app whose replacement name is empty", () => {
		expect(
			webAppRenameNameIssue(pair({ web: "nextjs", webName: "" }, [primary])),
		).toBe("Give the app at apps/web a name.");
	});

	it("reports how many dirty paths were omitted", async () => {
		await withTempDir("rename-dirty-many", async (root) => {
			await committed(root);

			for (const name of ["a.txt", "b.txt", "c.txt", "d.txt", "e.txt"])
				await writeText(join(root, name), "dirty\n");

			const issue = await Effect.runPromise(
				checkWebAppRenames(root, pair(config, [primary, site]), config, [
					primary,
					site,
				]).pipe(Effect.provide(layer)),
			);

			expect(issue).toContain("a.txt, b.txt, and c.txt and 2 more.");
			expect(issue).toContain("Commit or stash them first.");
		});
	});

	it("asks to commit a move only into a configured root missing its module", async () => {
		await withTempDir("rename-configured-move", async (root) => {
			await writeText(join(root, "apps/web/page.tsx"), "page\n");
			await committed(root);
			await git(root, ["mv", "apps/web", "apps/vault"]);
			const discovered = {
				...primary,
				root: "apps/vault",
				packageName: "@acme/vault",
			};

			const renames = pair(config, [discovered, site]);
			const issue = await Effect.runPromise(
				checkWebAppRenames(
					root,
					renames,
					{
						...config,
						webApps: [
							{ name: "marketing", framework: "nextjs" },
							{ name: "web", framework: "tanstack-router" },
						],
					},
					[discovered, site],
				).pipe(Effect.provide(layer)),
			);

			expect(issue).toContain("Commit the move first.");
		});
	});

	it("resumes a partial batch with transaction state despite Git dirt", async () => {
		await withTempDir("rename-resume-batch", async (root) => {
			await writeText(join(root, "apps/web/forge.json"), '{"id":"abcde"}\n');
			await writeText(join(root, "apps/site/forge.json"), '{"id":"fghij"}\n');
			await committed(root);
			await rename(join(root, "apps/web"), join(root, "apps/vault"));
			await writeText(join(root, ".forge/state.json"), "{}\n");

			expect(
				await Effect.runPromise(
					checkWebAppRenames(
						root,
						pair(config, [
							{ ...primary, root: "apps/vault", packageName: "@acme/vault" },
							site,
						]),
					).pipe(Effect.provide(layer)),
				),
			).toBeUndefined();
		});
	});

	it("ignores declined diffs and transaction files when checking Git", async () => {
		await withTempDir("rename-internal-dirt", async (root) => {
			await committed(root);
			await writeText(
				join(root, ".forge/declined/apps/web/page.diff"),
				"diff\n",
			);

			expect(
				await Effect.runPromise(
					checkWebAppRenames(root, pair(config, [primary, site])).pipe(
						Effect.provide(layer),
					),
				),
			).toBeUndefined();
		});
	});

	it("excludes every package manager lockfile from reference warnings", async () => {
		await withTempDir("rename-lock-references", async (root) => {
			for (const name of [
				"pnpm-lock.yaml",
				"package-lock.json",
				"yarn.lock",
				"bun.lock",
				"bun.lockb",
			])
				await writeText(join(root, name), "apps/web @acme/web\n");

			await committed(root);
			expect(
				await Effect.runPromise(
					scanRenameReferences(root, pair(config, [primary, site]), []).pipe(
						Effect.provide(layer),
					),
				),
			).toEqual([]);
		});
	});

	it("refuses an untracked project", async () => {
		await withTempDir("rename-untracked", async (root) => {
			expect(
				await Effect.runPromise(
					checkWebAppRenames(root, pair(config, [primary, site])).pipe(
						Effect.provide(layer),
					),
				),
			).toBe(
				"We can't rename web apps until Git tracks this project. Commit your project first.",
			);
		});
	});

	it("allows only manifest dirt and names other changed paths", async () => {
		await withTempDir("rename-dirty", async (root) => {
			await committed(root);
			await writeText(join(root, ".forge/manifest.json"), "edited\n");
			const renames = pair(config, [primary, site]);
			expect(
				await Effect.runPromise(
					checkWebAppRenames(root, renames).pipe(Effect.provide(layer)),
				),
			).toBeUndefined();

			await writeText(join(root, "README.md"), "edited\n");
			await writeText(join(root, "untracked.txt"), "new\n");
			expect(
				await Effect.runPromise(
					checkWebAppRenames(root, renames).pipe(Effect.provide(layer)),
				),
			).toBe(
				"We can't rename web apps while you have uncommitted changes in README.md and untracked.txt. Commit or stash them first.",
			);
		});
	});

	it("treats a dangling destination symlink as occupied", async () => {
		await withTempDir("rename-symlink", async (root) => {
			await mkdir(join(root, "apps"));
			await symlink("missing", join(root, "apps/vault"));

			expect(
				await Effect.runPromise(
					checkWebAppRenames(root, pair(config, [primary, site])).pipe(
						Effect.provide(layer),
					),
				),
			).toBe("apps/vault already exists. Pick another name for this web app.");
		});
	});

	it("does not call unrelated staged moves app renames", async () => {
		await withTempDir("rename-dirty-move", async (root) => {
			await writeText(join(root, "apps/other/page.tsx"), "page\n");
			await committed(root);
			await git(root, ["mv", "apps/other", "apps/moved"]);

			const issue = await Effect.runPromise(
				checkWebAppRenames(root, pair(config, [primary, site])).pipe(
					Effect.provide(layer),
				),
			);

			expect(issue).toContain("apps/moved/page.tsx and apps/other/page.tsx");
			expect(issue).toContain("Commit or stash them first.");
		});
	});

	it("reports remaining references inside apps and env without leaking values", async () => {
		await withTempDir("rename-references", async (root) => {
			await committed(root);
			await writeText(join(root, ".gitignore"), ".env*\n");
			await writeText(
				join(root, "apps/web/custom.ts"),
				"import '@acme/web/custom';\nimport '@acme/web-admin';\n",
			);

			await writeText(join(root, "README.md"), "apps/web apps/webhooks\n");
			await writeText(join(root, ".forge/note"), "@acme/web\n");
			await git(root, ["add", "."]);
			await rename(join(root, "apps/web"), join(root, "apps/vault"));
			await writeText(
				join(root, ".env"),
				"SECRET=do-not-print/apps/web\nPUBLIC='apps/web'\n",
			);

			const renames = pair(config, [primary, site]);
			const modules = renamedModules([primary, site], renames);
			await writeText(join(root, "apps/vault/.env.local"), "OLD='@acme/web'\n");
			const after = await Effect.runPromise(
				scanRenameReferences(root, renames, modules).pipe(
					Effect.provide(layer),
				),
			);

			const report = renameReport(renames, [], after, new Set());

			expect(report.warnings).toContain(
				"apps/vault/custom.ts still names @acme/web on line 1. Change it to @acme/vault.",
			);

			expect(report.warnings).toContain(
				"Line 2 of .env still names apps/web. Change it to apps/vault.",
			);

			expect(report.warnings).toContain(
				"Line 1 of apps/vault/.env.local still names @acme/web. Change it to @acme/vault.",
			);

			expect(report.warnings.join("\n")).not.toContain("do-not-print");
			expect(after).toHaveLength(5);
		});
	});

	it("lists rewritten existing files outside apps, not removed ones", () => {
		const renames = pair(config, [primary, site]);
		const hit = {
			line: 6,
			token: "@acme/web",
			replacement: "@acme/vault",
			env: false,
		};

		const before = [
			"package.json",
			"turbo.json",
			"gone.md",
			"apps/web/custom.ts",
		].map((path) => ({ ...hit, path }));

		expect(
			renameReport(
				renames,
				before,
				[],
				new Set(["package.json", "turbo.json", "apps/vault/custom.ts"]),
			),
		).toEqual({
			info: [
				"We moved apps/web to apps/vault and apps/site to apps/marketing.",
				"We updated the app references in package.json and turbo.json.",
			],
			warnings: [],
		});
	});

	it("prints one reserved or addon name sentence before generic validation", () => {
		expect(
			webAppRenameNameIssue(
				pair({ web: "nextjs", webName: "server" }, [primary]),
			),
		).toBe("server is reserved, so pick another name for this web app.");

		expect(
			webAppRenameNameIssue(
				pair(
					{
						web: "nextjs",
						webApps: [{ name: "tailwind", framework: "nextjs" }],
					},
					[primary, site],
				),
			),
		).toBe("tailwind is an addon id, so pick another name for this web app.");
	});

	it("uses the existing install command only when dependencies exist", async () => {
		await withTempDir("rename-install-hint", async (root) => {
			expect(
				await Effect.runPromise(
					renameInstallHint(root, config).pipe(Effect.provide(layer)),
				),
			).toBeUndefined();

			await writeText(join(root, "pnpm-lock.yaml"), "lock\n");

			expect(
				await Effect.runPromise(
					renameInstallHint(root, config).pipe(Effect.provide(layer)),
				),
			).toBe(
				"Run pnpm install --no-frozen-lockfile to refresh your workspace dependencies.",
			);
		});
	});
});
