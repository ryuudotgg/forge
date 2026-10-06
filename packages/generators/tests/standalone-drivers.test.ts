import { describe, expect, it } from "vitest";
import { plannedProject } from "./planner-harness";

type Plan = Awaited<ReturnType<typeof plannedProject>>;

function dependenciesAt(plan: Plan, path: string): ReadonlyArray<string> {
	const write = plan.writes.find((entry) => entry.path === path);
	if (write === undefined) throw new Error(`Missing Write: ${path}`);

	const parsed: unknown = JSON.parse(write.content);
	if (
		typeof parsed !== "object" ||
		parsed === null ||
		!("dependencies" in parsed) ||
		typeof parsed.dependencies !== "object" ||
		parsed.dependencies === null
	)
		return [];

	return Object.keys(parsed.dependencies);
}

const backends = ["hono", "express", "fastify"] as const;

const drivers: ReadonlyArray<{
	readonly orm: "drizzle" | "prisma";
	readonly databaseProvider?: "turso";
	readonly present: ReadonlyArray<string>;
	readonly absent: ReadonlyArray<string>;
}> = [
	{
		orm: "prisma",
		present: ["@prisma/adapter-better-sqlite3"],
		absent: ["@prisma/adapter-libsql", "@libsql/client"],
	},
	{
		orm: "prisma",
		databaseProvider: "turso",
		present: ["@prisma/adapter-libsql"],
		absent: ["@prisma/adapter-better-sqlite3"],
	},
	{
		orm: "drizzle",
		present: ["@libsql/client"],
		absent: ["@prisma/adapter-better-sqlite3", "@prisma/adapter-libsql"],
	},
	{
		orm: "drizzle",
		databaseProvider: "turso",
		present: ["@libsql/client"],
		absent: ["@prisma/adapter-better-sqlite3", "@prisma/adapter-libsql"],
	},
];

describe("standalone server database drivers", () => {
	it.each(
		backends.flatMap((backend) =>
			drivers.map((entry) => ({ ...entry, backend })),
		),
	)(
		"installs $present in the $backend server ($orm, $databaseProvider)",
		async ({ backend, orm, databaseProvider, present, absent }) => {
			const plan = await plannedProject({
				slug: "acme",
				authentication: "better-auth",
				authMethods: ["email-password"],
				backend,
				database: "sqlite",
				orm,
				packageManager: "pnpm",
				web: "tanstack-router",
				...(databaseProvider === undefined ? {} : { databaseProvider }),
			});

			const server = dependenciesAt(plan, "apps/server/package.json");
			const web = dependenciesAt(plan, "apps/web/package.json");

			for (const name of present) expect(server).toContain(name);
			for (const name of absent) expect(server).not.toContain(name);
			for (const name of present) expect(web).not.toContain(name);
		},
	);

	it.each(backends)(
		"keeps postgres drivers bundled in the %s server",
		async (backend) => {
			const plan = await plannedProject({
				slug: "acme",
				backend,
				database: "postgresql",
				orm: "prisma",
				packageManager: "pnpm",
			});

			expect(dependenciesAt(plan, "apps/server/package.json")).not.toContain(
				"@prisma/adapter-pg",
			);
		},
	);
});
