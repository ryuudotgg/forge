import { stripTypeScriptTypes } from "node:module";
import { Script } from "node:vm";
import { describe, expect, it } from "vitest";
import { renderBetterAuthTemplate } from "../src/auth/better-auth/shared";
import type { ForgeConfig } from "../src/config";
import { plannedProject } from "./planner-harness";

const config: ForgeConfig = {
	authentication: "better-auth",
	authMethods: ["email-password", "email-otp"],
	emailProvider: "smtp",
	database: "sqlite",
	orm: "drizzle",
	packageManager: "pnpm",
	slug: "acme",
	web: "nextjs",
};

const hosts = [
	{ backend: "hono", web: "nextjs", route: "apps/server/src/routes/auth.ts" },
	{
		backend: "express",
		web: "nextjs",
		route: "apps/server/src/routes/auth.ts",
	},
	{
		backend: "fastify",
		web: "nextjs",
		route: "apps/server/src/routes/auth.ts",
	},
	{
		backend: "self",
		web: "nextjs",
		route: "apps/web/app/api/auth/[...all]/route.ts",
	},
	{
		backend: "self",
		web: "tanstack-start",
		route: "apps/web/src/routes/api/auth/$.ts",
	},
	{
		backend: "self",
		web: "react-router",
		route: "apps/web/app/routes/api.auth.$.ts",
	},
] satisfies ReadonlyArray<{
	backend: ForgeConfig["backend"];
	web: ForgeConfig["web"];
	route: string;
}>;

function writeContent(
	plan: Awaited<ReturnType<typeof plannedProject>>,
	path: string,
) {
	const write = plan.writes.find((entry) => entry.path === path);
	if (write === undefined) throw new Error(`Missing Write: ${path}`);
	return write.content;
}

function backgroundResult(
	expression: string,
	bindings: Record<string, unknown> = {},
): unknown {
	const source = renderBetterAuthTemplate(
		config,
		"packages/auth/src/background.ts",
	).replaceAll("export ", "");

	return new Script(
		`${stripTypeScriptTypes(source)}\n${expression};`,
	).runInNewContext(bindings);
}

describe("generated background tasks", () => {
	for (const orm of ["drizzle", "prisma"] satisfies ReadonlyArray<
		ForgeConfig["orm"]
	>)
		it.each(hosts)(
			`wires ${orm} background tasks for $backend with $web`,
			async ({ backend, web, route }) => {
				const plan = await plannedProject({ ...config, backend, orm, web });
				const auth = writeContent(plan, "packages/auth/src/index.ts");
				const handler = writeContent(plan, route);

				expect(auth).toContain("backgroundTasks: { handler: runInBackground }");
				expect(auth).toContain(
					'import { runInBackground } from "@acme/auth/background";',
				);

				expect(
					JSON.parse(writeContent(plan, "packages/auth/package.json")),
				).toMatchObject({ exports: { "./background": "./src/background.ts" } });

				expect(writeContent(plan, "packages/auth/src/background.ts")).toContain(
					"export function runInBackground",
				);

				if (backend === "self" && web === "nextjs") {
					expect(handler).toContain('import { after } from "next/server";');
					expect(handler).toContain(
						'import { runBackgroundTasksWith } from "@acme/auth/background";',
					);

					expect(handler).toContain("runBackgroundTasksWith(after);");
					expect(
						handler.indexOf("runBackgroundTasksWith(after);"),
					).toBeLessThan(handler.indexOf("export const { GET, POST }"));
				} else expect(handler).not.toMatch(/background|after/);
			},
		);

	it("hands the original task to the registered runner", () => {
		const task = Promise.resolve("sent");
		const received: Promise<unknown>[] = [];

		expect(
			backgroundResult(
				"runBackgroundTasksWith(collect); runInBackground(task)",
				{ task, collect: (next: Promise<unknown>) => received.push(next) },
			),
		).toBeUndefined();

		expect(received).toEqual([task]);
	});

	it("returns immediately without a runner or a settled task", () => {
		const task = new Promise<unknown>(() => {});
		expect(backgroundResult("runInBackground(task)", { task })).toBeUndefined();
	});
});
