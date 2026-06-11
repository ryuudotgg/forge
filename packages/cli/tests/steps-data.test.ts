import { databaseProviders, postgresProviderIdsFor } from "@ryuujs/generators";
import { beforeEach, describe, expect, it, vi } from "vitest";
import databaseStep from "../src/steps/data/database";
import databaseProviderStep from "../src/steps/data/database-provider";
import ormStep from "../src/steps/data/orm";
import { type PartialConfig, SKIP } from "../src/steps/types";

const promptMocks = vi.hoisted(() => ({
	cancel: vi.fn(),
	isCancel: vi.fn(),
	select: vi.fn(),
}));

vi.mock("@clack/prompts", () => ({
	cancel: promptMocks.cancel,
	isCancel: promptMocks.isCancel,
	select: promptMocks.select,
}));

function rawConfig(values: { [key: string]: unknown }): PartialConfig {
	const config: PartialConfig = {};
	return Object.assign(config, values);
}

describe("database step", () => {
	beforeEach(() => {
		promptMocks.cancel.mockReset();
		promptMocks.isCancel.mockReset();
		promptMocks.select.mockReset();
		promptMocks.isCancel.mockReturnValue(false);
	});

	it("only runs when a non-convex backend is selected", () => {
		expect(databaseStep.shouldRun({})).toBe(false);
		expect(databaseStep.shouldRun({ backend: "convex" })).toBe(false);
		expect(databaseStep.shouldRun({ backend: "hono" })).toBe(true);
	});

	it("accepts a canonical database id without prompting", async () => {
		await expect(
			databaseStep.execute({ database: "postgresql" }, false),
		).resolves.toBe("postgresql");

		expect(promptMocks.select).not.toHaveBeenCalled();
	});

	it("normalizes display-name aliases in non-interactive mode", async () => {
		await expect(
			databaseStep.execute(rawConfig({ database: "PostgreSQL" }), false),
		).resolves.toBe("postgresql");
	});

	it("skips when the configured database is unknown", async () => {
		await expect(
			databaseStep.execute(rawConfig({ database: "oracle" }), false),
		).resolves.toBe(SKIP);
	});

	it("returns the selected database", async () => {
		promptMocks.select.mockResolvedValue("mysql");

		await expect(databaseStep.execute({}, true)).resolves.toBe("mysql");

		expect(promptMocks.select).toHaveBeenCalledWith({
			message: "What is your preferred database?",
			options: [
				{ label: "MySQL", value: "mysql" },
				{ label: "PostgreSQL", value: "postgresql" },
				{ label: "SQLite", value: "sqlite" },
				{ label: "None", value: "none" },
			],
		});
	});

	it("skips when none is selected", async () => {
		promptMocks.select.mockResolvedValue("none");

		await expect(databaseStep.execute({}, true)).resolves.toBe(SKIP);
	});
});

describe("orm step", () => {
	beforeEach(() => {
		promptMocks.cancel.mockReset();
		promptMocks.isCancel.mockReset();
		promptMocks.select.mockReset();
		promptMocks.isCancel.mockReturnValue(false);
	});

	it("only runs when a database is selected", () => {
		expect(ormStep.shouldRun({})).toBe(false);
		expect(ormStep.shouldRun({ database: "sqlite" })).toBe(true);
	});

	it("accepts a canonical orm id without prompting", async () => {
		await expect(ormStep.execute({ orm: "prisma" }, false)).resolves.toBe(
			"prisma",
		);

		expect(promptMocks.select).not.toHaveBeenCalled();
	});

	it("normalizes display-name aliases in non-interactive mode", async () => {
		await expect(
			ormStep.execute(rawConfig({ orm: "Drizzle ORM" }), false),
		).resolves.toBe("drizzle");
	});

	it("skips when the configured orm is unknown", async () => {
		await expect(
			ormStep.execute(rawConfig({ orm: "typeorm" }), false),
		).resolves.toBe(SKIP);
	});

	it("returns the selected orm", async () => {
		promptMocks.select.mockResolvedValue("drizzle");

		await expect(ormStep.execute({}, true)).resolves.toBe("drizzle");

		expect(promptMocks.select).toHaveBeenCalledWith({
			message: "What is your preferred ORM?",
			options: [
				{ label: "Drizzle ORM", value: "drizzle" },
				{ label: "Prisma", value: "prisma" },
				{ label: "None", value: "none" },
			],
		});
	});

	it("skips when none is selected", async () => {
		promptMocks.select.mockResolvedValue("none");

		await expect(ormStep.execute({}, true)).resolves.toBe(SKIP);
	});
});

describe("databaseProvider step", () => {
	beforeEach(() => {
		promptMocks.cancel.mockReset();
		promptMocks.isCancel.mockReset();
		promptMocks.select.mockReset();
		promptMocks.isCancel.mockReturnValue(false);
	});

	it("offers PlanetScale for mysql", async () => {
		promptMocks.select.mockResolvedValue("none");

		await databaseProviderStep.execute({ database: "mysql" }, true);

		expect(promptMocks.select).toHaveBeenCalledWith({
			message: "Do you want a managed MySQL database?",
			options: [
				{ label: "PlanetScale", value: "planetscale" },
				{ label: "None", value: "none" },
			],
		});
	});

	it("offers Turso for sqlite", async () => {
		promptMocks.select.mockResolvedValue("none");

		await databaseProviderStep.execute({ database: "sqlite" }, true);

		expect(promptMocks.select).toHaveBeenCalledWith({
			message: "Do you want a managed SQLite database?",
			options: [
				{ label: "Turso", value: "turso" },
				{ label: "None", value: "none" },
			],
		});
	});

	it("omits Prisma Postgres from the postgres providers for drizzle", async () => {
		promptMocks.select.mockResolvedValue("none");

		await databaseProviderStep.execute(
			{ database: "postgresql", orm: "drizzle" },
			true,
		);

		expect(promptMocks.select).toHaveBeenCalledWith({
			message: "Do you want a managed PostgreSQL database?",
			options: [
				...postgresProviderIdsFor("drizzle").map((provider) => ({
					label: databaseProviders.label(provider),
					value: provider,
				})),
				{ label: "None", value: "none" },
			],
		});
		expect(promptMocks.select).toHaveBeenCalledWith(
			expect.objectContaining({
				options: expect.not.arrayContaining([
					{ label: "Prisma Postgres", value: "prisma-postgres" },
				]),
			}),
		);
	});

	it("adds Prisma Postgres to the postgres providers for prisma", async () => {
		promptMocks.select.mockResolvedValue("none");

		await databaseProviderStep.execute(
			{ database: "postgresql", orm: "prisma" },
			true,
		);

		expect(promptMocks.select).toHaveBeenCalledWith({
			message: "Do you want a managed PostgreSQL database?",
			options: [
				...postgresProviderIdsFor("prisma").map((provider) => ({
					label: databaseProviders.label(provider),
					value: provider,
				})),
				{ label: "None", value: "none" },
			],
		});
		expect(promptMocks.select).toHaveBeenCalledWith(
			expect.objectContaining({
				options: expect.arrayContaining([
					{ label: "Prisma Postgres", value: "prisma-postgres" },
				]),
			}),
		);
	});

	it("returns the selected provider", async () => {
		promptMocks.select.mockResolvedValue("turso");

		await expect(
			databaseProviderStep.execute({ database: "sqlite" }, true),
		).resolves.toBe("turso");
	});

	it("skips when none is selected", async () => {
		promptMocks.select.mockResolvedValue("none");

		await expect(
			databaseProviderStep.execute({ database: "mysql" }, true),
		).resolves.toBe(SKIP);
	});

	it("skips interactively when no database was chosen", async () => {
		await expect(databaseProviderStep.execute({}, true)).resolves.toBe(SKIP);

		expect(promptMocks.select).not.toHaveBeenCalled();
	});

	it("exits when the provider prompt is cancelled", async () => {
		const exit = vi.spyOn(process, "exit").mockImplementation(((
			code?: string | number | null,
		) => {
			throw new Error(`exit:${code ?? 0}`);
		}) as never);

		try {
			promptMocks.select.mockResolvedValue(Symbol.for("clack:cancel"));
			promptMocks.isCancel.mockReturnValue(true);

			await expect(
				databaseProviderStep.execute({ database: "mysql" }, true),
			).rejects.toThrow("exit:0");

			expect(promptMocks.cancel).toHaveBeenCalledWith(
				"You've extinguished the forge.",
			);
		} finally {
			exit.mockRestore();
		}
	});

	it("accepts a configured provider without checking database compatibility", async () => {
		await expect(
			databaseProviderStep.execute(
				{ database: "mysql", databaseProvider: "turso" },
				false,
			),
		).resolves.toBe("turso");
	});

	it("skips when the configured provider is unknown", async () => {
		await expect(
			databaseProviderStep.execute(
				rawConfig({ database: "mysql", databaseProvider: "bogus" }),
				false,
			),
		).resolves.toBe(SKIP);
	});

	it("skips non-interactively when no provider is configured", async () => {
		await expect(
			databaseProviderStep.execute({ database: "mysql" }, false),
		).resolves.toBe(SKIP);
	});
});
