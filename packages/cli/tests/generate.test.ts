import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	defineAddon,
	defineFramework,
	defineRegistry,
	defineTemplate,
	ensureAppModule,
} from "@ryuujs/core";
import * as generators from "@ryuujs/generators";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import generateStep from "../src/steps/generate";
import { SKIP } from "../src/steps/types";

const promptMocks = vi.hoisted(() => ({
	logError: vi.fn(),
}));

vi.mock("@clack/prompts", () => ({
	log: { error: promptMocks.logError },
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

async function readJson(path: string): Promise<unknown> {
	return JSON.parse(await readFile(path, "utf-8"));
}

describe("generate step", () => {
	beforeEach(() => {
		promptMocks.logError.mockReset();
		vi.spyOn(generators, "probeWorkspaceCommandVersions").mockReturnValue(
			Effect.succeed({ node: "22.11.0", npm: "11.0.0", pnpm: "10.12.1" }),
		);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("writes the planned project to disk and returns SKIP", async () => {
		await withTempDir("generate-test", async (directory) => {
			const result = await generateStep.execute(
				{
					name: "Acme",
					slug: "acme",
					path: directory,
					web: "nextjs",
					packageManager: "pnpm",
					runtime: "Node.js",
				},
				false,
			);

			expect(result).toBe(SKIP);

			const workspacePackage = await readJson(join(directory, "package.json"));
			expect(workspacePackage).toMatchObject({ name: "acme" });

			const manifest = await readJson(
				join(directory, ".forge", "manifest.json"),
			);

			expect(manifest).toMatchObject({
				config: expect.objectContaining({ slug: "acme" }),
			});
		});
	}, 120_000);

	it("plans a full TanStack Start project at framework slot paths", async () => {
		await withTempDir("generate-tanstack-start", async (directory) => {
			const result = await generateStep.execute(
				{
					authentication: "better-auth",
					database: "postgresql",
					linter: "biome",
					name: "Acme",
					orm: "drizzle",
					packageManager: "npm",
					path: directory,
					platforms: ["web"],
					rpc: "trpc",
					runtime: "Node.js",
					slug: "acme",
					style: "tailwind",
					web: "tanstack-start",
				},
				false,
			);

			expect(result).toBe(SKIP);

			const expectedWebFiles = [
				"src/routes/__root.tsx",
				"src/routes/index.tsx",
				"src/routes/api/trpc/$.ts",
				"src/routes/api/auth/$.ts",
				"src/providers.tsx",
				"src/router.tsx",
				"src/routeTree.gen.ts",
				"components.json",
			];
			for (const path of expectedWebFiles)
				expect(
					await readFile(join(directory, "apps/web", path), "utf-8"),
					path,
				).not.toHaveLength(0);

			const manifest = await readJson(
				join(directory, ".forge", "manifest.json"),
			);
			expect(manifest).toMatchObject({
				config: expect.objectContaining({ web: "tanstack-start" }),
			});
			expect(JSON.stringify(manifest)).toContain(
				'"definitionIds":["tanstack-start/base"]',
			);

			const trpcRoute = await readFile(
				join(directory, "apps/web/src/routes/api/trpc/$.ts"),
				"utf-8",
			);
			expect(trpcRoute).toContain('createFileRoute("/api/trpc/$")');
			expect(trpcRoute).toContain('import { auth } from "@acme/auth";');

			const authIndex = await readFile(
				join(directory, "packages/auth/src/index.ts"),
				"utf-8",
			);
			expect(authIndex).toContain(
				'import { tanstackStartCookies } from "better-auth/tanstack-start";',
			);

			const components = await readJson(
				join(directory, "apps/web/components.json"),
			);
			expect(components).toMatchObject({ rsc: false });
		});
	}, 120_000);

	it("plans a full React Router project with registered resource routes", async () => {
		await withTempDir("generate-react-router", async (directory) => {
			const result = await generateStep.execute(
				{
					authentication: "better-auth",
					database: "postgresql",
					linter: "biome",
					name: "Acme",
					orm: "drizzle",
					packageManager: "pnpm",
					path: directory,
					platforms: ["web"],
					rpc: "trpc",
					runtime: "Node.js",
					slug: "acme",
					style: "tailwind",
					web: "react-router",
				},
				false,
			);

			expect(result).toBe(SKIP);

			for (const path of [
				"app/root.tsx",
				"app/routes/home.tsx",
				"app/routes/api.trpc.$.ts",
				"app/routes/api.auth.$.ts",
				"app/providers.tsx",
				"app/routes.ts",
				"react-router.config.ts",
				"vite.config.ts",
				"components.json",
			])
				expect(
					await readFile(join(directory, "apps/web", path), "utf-8"),
					path,
				).not.toHaveLength(0);

			const routes = await readFile(
				join(directory, "apps/web/app/routes.ts"),
				"utf-8",
			);
			expect(routes).toContain('route("api/trpc/*", "routes/api.trpc.$.ts")');
			expect(routes).toContain('route("api/auth/*", "routes/api.auth.$.ts")');
			expect(routes).not.toMatch(/__[A-Z_]+__/);

			const authIndex = await readFile(
				join(directory, "packages/auth/src/index.ts"),
				"utf-8",
			);
			expect(authIndex).not.toContain("tanstackStartCookies");
			expect(authIndex).not.toContain("nextCookies");

			const manifest = await readJson(
				join(directory, ".forge", "manifest.json"),
			);
			expect(manifest).toMatchObject({
				config: expect.objectContaining({ web: "react-router" }),
			});
			expect(JSON.stringify(manifest)).toContain(
				'"definitionIds":["react-router/base"]',
			);
		});
	}, 120_000);

	it("requires an orm before generating with better auth", async () => {
		const exit = vi.spyOn(process, "exit").mockImplementation(((
			code?: string | number | null,
		) => {
			throw new Error(`exit:${code ?? 0}`);
		}) as never);

		try {
			await withTempDir("generate-test", async (directory) => {
				await expect(
					generateStep.execute(
						{ authentication: "better-auth", path: directory },
						false,
					),
				).rejects.toThrow("exit:1");

				expect(promptMocks.logError).toHaveBeenCalledWith(
					"You need to add an ORM before you can use Better Auth.",
				);
			});
		} finally {
			exit.mockRestore();
		}
	});

	it("wraps planner and apply failures as a generation failure", async () => {
		await withTempDir("generate-test", async (directory) => {
			const blocked = join(directory, "blocked");
			await writeFile(blocked, "not a directory", "utf-8");

			await expect(
				generateStep.execute(
					{
						name: "Acme",
						slug: "acme",
						path: blocked,
						web: "nextjs",
						packageManager: "pnpm",
						runtime: "Node.js",
					},
					false,
				),
			).rejects.toThrow(/^Generation Failed: /);
		});
	}, 120_000);

	it("formats create apply refusals with resolution guidance", async () => {
		await withTempDir("generate-apply-refusal", async (directory) => {
			await writeFile(join(directory, ".gitignore"), "user-owned\n", "utf-8");

			await expect(
				generateStep.execute(
					{
						name: "Acme",
						packageManager: "pnpm",
						path: directory,
						runtime: "Node.js",
						slug: "acme",
						web: "nextjs",
					},
					false,
				),
			).rejects.toHaveProperty(
				"message",
				"Generation Failed: Forge cannot safely update these files:\n.gitignore already exists and is not managed by Forge.\n--keep-user cannot resolve unmanaged files; use --accept-forge to overwrite and manage them.",
			);
		});
	}, 120_000);

	it("surfaces a missing framework slot as a natural sentence", async () => {
		const fakeFramework = defineFramework({
			id: "fake",
			configFile: "fake.config.ts",
			buildOutputs: [],
			ignoreDirs: [],
			name: "Fake Framework",
			sourceRoot: "",
			slots: ["layout"],
			tsconfigPreset: { content: {}, name: "fake" },
		});
		const fakeTemplate = defineTemplate<generators.ForgeConfig>({
			id: "fake/base",
			framework: "fake",
			name: "Fake Base",
			version: 1,
			category: "web",
			exclusive: true,
			when: (config) => config.web === "nextjs",
			contribute: () => [
				ensureAppModule("web", "apps/web", {
					framework: "fake",
					template: { id: "fake/base", version: 1 },
					slots: { layout: "app/layout.tsx" },
				}),
			],
		});
		const trpc = defineAddon<generators.ForgeConfig>({
			id: "trpc",
			name: "tRPC",
			version: "0.1.0",
			category: "addon",
			exclusive: false,
			targetMode: "single",
			compatibility: {
				app: {
					frameworks: ["fake"],
					requiredSlots: ["trpc"],
				},
			},
			when: (config) => config.rpc === "trpc",
			contribute: () => [],
		});
		const loadRegistry = vi
			.spyOn(generators, "loadDefinitionRegistry")
			.mockReturnValue({
				catalog: [],
				descriptors: [],
				registry: defineRegistry({
					frameworks: [fakeFramework],
					templates: [fakeTemplate],
					addons: [trpc],
				}),
			});

		try {
			await withTempDir("generate-missing-slot", async (directory) => {
				await expect(
					generateStep.execute(
						{
							path: directory,
							rpc: "trpc",
							web: "nextjs",
						},
						false,
					),
				).rejects.toThrow(
					"Generation Failed: tRPC requires the trpc slot, but Fake Framework does not provide it.",
				);
			});
		} finally {
			loadRegistry.mockRestore();
		}
	});
});
