import { platforms } from "@ryuugg/generators";
import { Schema } from "effect";
import { describe, expect, it, vi } from "vitest";
import {
	assembleSchema,
	configIssue,
	droppedValueIssue,
} from "../src/config/schema";
import { steps } from "../src/steps";

describe("dropped value validation", () => {
	it.each([
		{
			config: { database: "postgresql", databaseProvider: "turso" },
			message:
				"Turso doesn't host PostgreSQL, so pick PlanetScale, Neon, Nile, Supabase, or Prisma Postgres.",
		},
		{
			config: { database: "sqlite", databaseProvider: "planetscale" },
			message: "PlanetScale doesn't host SQLite, so pick Turso.",
		},
		{
			config: { database: "mysql", databaseProvider: "neon" },
			message: "Neon doesn't host MySQL, so pick PlanetScale.",
		},
		{
			config: { catalogs: "flat", packageManager: "npm" },
			message: "pnpm Catalogs need pnpm.",
		},
		{
			config: { desktop: "electron" },
			message: "We don't support Desktop yet.",
		},
	])("rejects $config", ({ config, message }) => {
		expect(droppedValueIssue(config)).toBe(message);
		expect(configIssue(config)).toBe(message);
		expect(() =>
			Schema.decodeSync(assembleSchema(steps))({
				name: "Acme",
				slug: "acme",
				...config,
			}),
		).toThrow(message);
	});

	it.each([
		{},
		{ database: "postgresql" },
		{ catalogs: "flat" },
		{ packageManager: "npm" },
		{ catalogs: "scoped", packageManager: "pnpm" },
		{ database: "postgresql", databaseProvider: "nile", orm: "prisma" },
		{
			database: "postgresql",
			databaseProvider: "prisma-postgres",
			orm: "drizzle",
		},
	])("keeps partial and supported config $config", (config) => {
		expect(droppedValueIssue(config)).toBeUndefined();
		expect(configIssue(config)).toBeUndefined();
	});

	it("leaves a provider without a database to the final decode", () => {
		const config = { databaseProvider: "neon" };

		expect(droppedValueIssue(config)).toBeUndefined();
		expect(configIssue(config)).toBe("A database provider needs a database.");
		expect(() =>
			Schema.decodeSync(assembleSchema(steps))({
				name: "Acme",
				slug: "acme",
				...config,
			}),
		).toThrow("A database provider needs a database.");
	});

	it("requires the desktop platform only once desktop is available", () => {
		const available = vi.spyOn(platforms, "available").mockReturnValue(true);
		try {
			expect(
				configIssue({ desktop: "electron", platforms: ["web"], web: "nextjs" }),
			).toBe("A desktop framework needs the Desktop platform.");

			expect(droppedValueIssue({ desktop: "electron", platforms: [] })).toBe(
				"A desktop framework needs the Desktop platform.",
			);

			expect(
				configIssue({ desktop: "electron", platforms: ["desktop"] }),
			).toBeUndefined();

			expect(configIssue({ desktop: "electron" })).toBeUndefined();
		} finally {
			available.mockRestore();
		}
	});
});
