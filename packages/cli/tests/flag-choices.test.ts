import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { packageManagers, runtimes } from "@ryuugg/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildFlagOverrides, decodeChoice, options } from "../src/cli";
import { runCreate } from "../src/commands/create";
import { defaultCommand, getSubcommand } from "../src/commands/registry";
import { runCli } from "../src/index";
import type { Choices } from "../src/utils/choices";
import { listOr } from "../src/utils/list";

const mocks = vi.hoisted(() => ({
	orchestrate: vi.fn(),
	prompt: vi.fn(),
	logError: vi.fn(),
}));

vi.mock("../src/orchestrator", () => ({ orchestrate: mocks.orchestrate }));
vi.mock("@clack/prompts", async (importOriginal) => ({
	...(await importOriginal<typeof import("@clack/prompts")>()),
	select: mocks.prompt,
	text: mocks.prompt,
	confirm: mocks.prompt,
	multiselect: mocks.prompt,
	log: { error: mocks.logError },
}));

describe("choice flags", () => {
	beforeEach(() => vi.clearAllMocks());

	for (const [key, option] of Object.entries(options)) {
		if (!("choices" in option)) continue;

		const table: Choices<string> = option.choices;
		for (const id of table.ids) {
			const label = table.label(id);
			const available = listOr.format(
				table.ids
					.filter((choice) => table.available(choice))
					.map((choice) => table.label(choice)),
			);
			const message = `We don't support ${label} for --${key} yet, so pick ${available}.`;
			it(`${key} accepts every spelling of ${id}`, () => {
				for (const spelling of [
					id,
					id.toUpperCase(),
					label,
					label.toUpperCase(),
					label.toLowerCase(),
				]) {
					const values = { [key]: key === "web" ? [spelling] : spelling };
					if (table.available(id))
						expect(buildFlagOverrides(values)).toEqual(
							buildFlagOverrides({ [key]: key === "web" ? [id] : id }),
						);
					else expect(() => buildFlagOverrides(values)).toThrow(message);
				}
			});

			it(`${key} decodes the help label ${label}`, () => {
				if (table.available(id))
					expect(decodeChoice(table, label, { flag: `--${key}` })).toBe(id);
				else
					expect(() =>
						decodeChoice(table, label, { flag: `--${key}` }),
					).toThrow(message);
			});
		}
	}

	it("accepts environment record keys while storing display names", () => {
		for (const [key, value] of Object.entries(runtimes))
			expect(buildFlagOverrides({ runtime: key })).toEqual({
				runtime: value.displayName,
			});

		for (const [key, value] of Object.entries(packageManagers))
			expect(buildFlagOverrides({ "package-manager": key })).toEqual({
				packageManager: value.displayName,
			});
	});

	it("preserves backend aliases and decodes named web apps", () => {
		expect(buildFlagOverrides({ backend: "NEXT.JS" })).toEqual({
			backend: "self",
		});
		expect(buildFlagOverrides({ backend: "NEXTJS" })).toEqual({
			backend: "self",
		});
		expect(buildFlagOverrides({ web: ["admin=NEXT.JS+client"] })).toEqual({
			webApps: [{ name: "admin", framework: "nextjs", client: true }],
		});
	});

	it.each([[], ["--yes"]])(
		"refuses an invalid ORM before prompts with flags %j",
		async (...flags) => {
			const error = vi.fn();
			const log = vi.fn();
			const setExitCode = vi.fn();
			await runCli(["create", "--orm", "nope", ...flags], {
				checkRuntime: () => ({ ok: true, message: "" }),
				defaultCommand,
				getSubcommand,
				error,
				log,
				setExitCode,
				exit: vi.fn(),
				printHelp: vi.fn(),
			});

			expect(setExitCode).toHaveBeenCalledWith(1);
			expect(error.mock.calls).toEqual([
				['--orm takes Drizzle ORM or Prisma, not "nope".'],
			]);
			expect(mocks.prompt).not.toHaveBeenCalled();
			expect(mocks.orchestrate).not.toHaveBeenCalled();
			expect(mocks.logError).not.toHaveBeenCalled();
			expect(
				JSON.stringify([...error.mock.calls, ...log.mock.calls]),
			).not.toMatch(/Invalid Configuration:|Expected undefined/);
		},
	);
});

describe("config choice decoding", () => {
	beforeEach(() => vi.clearAllMocks());

	async function withConfig(
		config: unknown,
		run: (path: string) => Promise<void>,
	) {
		const directory = await mkdtemp(join(tmpdir(), "forge-choices-"));
		try {
			const path = join(directory, "config.json");
			await writeFile(path, JSON.stringify(config));
			await run(path);
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	}

	it("normalizes config choices and secondary web frameworks", async () => {
		await withConfig(
			{
				runtime: "node",
				catalogs: "Flat",
				web: "NEXT.JS",
				webApps: [{ name: "admin", framework: "React Router" }],
			},
			async (config) => {
				await runCreate({ config });

				expect(mocks.orchestrate).toHaveBeenCalledWith(
					expect.anything(),
					expect.objectContaining({
						initialConfig: {
							runtime: "Node.js",
							catalogs: "flat",
							web: "nextjs",
							webApps: [{ name: "admin", framework: "react-router" }],
						},
					}),
				);
			},
		);
	});

	it("refuses an unknown config choice before orchestration", async () => {
		await withConfig({ orm: "nope" }, async (config) => {
			await expect(runCreate({ config })).rejects.toThrow(
				'Your config file sets "orm" to "nope", but it takes Drizzle ORM or Prisma.',
			);

			expect(mocks.orchestrate).not.toHaveBeenCalled();
		});
	});

	it("lets flags override invalid config choices", async () => {
		await withConfig(
			{ orm: "nope", webApps: [{ name: "admin", framework: "nope" }] },
			async (config) => {
				await runCreate({ config, orm: "drizzle", web: ["admin=nextjs"] });

				expect(mocks.orchestrate).toHaveBeenCalledWith(
					expect.anything(),
					expect.objectContaining({
						initialConfig: {
							orm: "drizzle",
							webApps: [{ name: "admin", framework: "nextjs" }],
						},
					}),
				);
			},
		);
	});

	it("names the config key when a choice is unavailable", () => {
		expect(() =>
			decodeChoice(options.backend.choices, "Convex", { configKey: "backend" }),
		).toThrow(
			'We don\'t support Convex for "backend" in your config file yet, so pick Same app, Hono, Fastify, or Express.',
		);
	});
});
