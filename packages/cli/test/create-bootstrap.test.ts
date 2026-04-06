import { constants } from "node:fs";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { NodeContext } from "@effect/platform-node";
import { Effect, Layer } from "effect";
import { describe, expect, it, vi } from "vitest";
import {
	CoreLive,
	filePath,
	type Generator,
	type ResolvedFile,
} from "../../core/src/index";
import { readJson, withTempDir } from "../../core/test/harness";
import { bootstrapProject } from "../src/bootstrap/project";
import { failLifecycleCommand } from "../src/commands/lifecycle";

interface TestConfig extends Record<string, unknown> {
	readonly style?: string;
}

const coreLayer = CoreLive.pipe(Layer.provideMerge(NodeContext.layer));

function makeGenerator(id: string): Generator<TestConfig> {
	return {
		id,
		name: id,
		version: "0.0.0-test",
		category: "addon",
		exclusive: false,
		dependencies: [],
		appliesTo: () => true,
		generate: () => Effect.succeed([]),
	};
}

async function pathExists(path: string) {
	try {
		await access(path, constants.F_OK);
		return true;
	} catch {
		return false;
	}
}

describe("project bootstrap", () => {
	it("writes root state and module metadata after generation", async () => {
		await withTempDir("create-bootstrap", async (directory) => {
			const config: TestConfig = { style: "Tailwind CSS" };
			const ordered = [
				makeGenerator("frameworks/nextjs"),
				makeGenerator("ui"),
			] satisfies ReadonlyArray<Generator<TestConfig>>;
			const resolved = [
				{
					content: "",
					generators: ["frameworks/nextjs"],
					path: filePath("apps/web/app/layout.tsx"),
				},
				{
					content: "",
					generators: ["frameworks/nextjs"],
					path: filePath("apps/web/app/page.tsx"),
				},
				{
					content: "",
					generators: ["frameworks/nextjs"],
					path: filePath("apps/web/app/api/health/route.ts"),
				},
				{
					content: "",
					generators: ["ui"],
					path: filePath("packages/ui/src/styles/globals.css"),
				},
				{
					content: "",
					generators: ["ui"],
					path: filePath("packages/ui/src/styles/theme.css"),
				},
				{
					content: "",
					generators: ["ui"],
					path: filePath("packages/ui/src/lib/utils.ts"),
				},
				{
					content: "",
					generators: ["ui"],
					path: filePath("packages/ui/postcss.config.mjs"),
				},
			] satisfies ReadonlyArray<ResolvedFile>;

			await mkdir(join(directory, "apps/web"), { recursive: true });
			await mkdir(join(directory, "packages/ui"), { recursive: true });
			await writeFile(
				join(directory, "apps/web/package.json"),
				JSON.stringify({ name: "@acme/web" }),
				"utf-8",
			);
			await writeFile(
				join(directory, "packages/ui/package.json"),
				JSON.stringify({ name: "@acme/ui" }),
				"utf-8",
			);

			await bootstrapProject({
				config,
				ordered,
				projectRoot: directory,
				resolved,
			}).pipe(Effect.provide(coreLayer), Effect.runPromise);

			const manifest = await readJson<{
				version: number;
				modules: Record<string, object>;
			}>(join(directory, ".forge/manifest.json"));

			const lockfile = await readJson<{ version: number }>(
				join(directory, ".forge/lock.json"),
			);

			const appConfig = await readJson<{
				id: string;
				type: string;
				framework: string;
				template: { id: string; version: number };
				slots: Record<string, string>;
			}>(join(directory, "apps/web/forge.json"));

			const uiConfig = await readJson<{
				id: string;
				type: string;
				packageType: string;
				capabilities: string[];
				template: { id: string; version: number };
				slots: Record<string, string>;
			}>(join(directory, "packages/ui/forge.json"));

			expect(manifest.version).toBe(1);
			expect(lockfile.version).toBe(1);

			expect(Object.keys(manifest.modules)).toEqual(
				expect.arrayContaining([appConfig.id, uiConfig.id]),
			);

			expect(appConfig.type).toBe("app");
			expect(appConfig.framework).toBe("nextjs");
			expect(appConfig.template).toEqual({ id: "base", version: 1 });
			expect(appConfig.slots).toMatchObject({
				layout: "app/layout.tsx",
				page: "app/page.tsx",
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

			expect(appConfig.id).toMatch(/^[a-z]{5}$/);
			expect(uiConfig.id).toMatch(/^[a-z]{5}$/);
			expect(appConfig.id).not.toBe(uiConfig.id);

			expect(await pathExists(join(directory, ".forge/forge.lock"))).toBe(
				false,
			);

			expect(
				JSON.parse(
					await readFile(join(directory, ".forge/manifest.json"), "utf-8"),
				),
			).toEqual(manifest);
		});
	});

	it("fails fast for managed projects in addon lifecycle commands", async () => {
		await withTempDir("managed-gate", async (directory) => {
			await mkdir(join(directory, ".forge"), { recursive: true });
			await writeFile(
				join(directory, ".forge/lock.json"),
				JSON.stringify({ version: 1, provenance: {}, resolutions: {} }),
				"utf-8",
			);

			const exit = vi.spyOn(process, "exit").mockImplementation(((
				code?: number,
			) => {
				throw new Error(`exit:${String(code ?? 0)}`);
			}) as never);

			const prompts = await import("@clack/prompts");
			const errorLog = vi
				.spyOn(prompts.log, "error")
				.mockImplementation(() => {});

			await expect(failLifecycleCommand(directory, "add")).rejects.toThrow(
				"exit:1",
			);

			expect(errorLog).toHaveBeenCalledWith(
				expect.stringContaining(`We haven't implemented "add" yet`),
			);

			exit.mockRestore();
			errorLog.mockRestore();
		});
	});
});
