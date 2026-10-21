import { describe, expect, it } from "vitest";
import type { ForgeConfig } from "../src/config";
import { plannedProject } from "./planner-harness";

function writeContent(
	plan: Awaited<ReturnType<typeof plannedProject>>,
	path: string,
): string {
	const write = plan.writes.find((entry) => entry.path === path);
	if (write === undefined) throw new Error(`Missing Write: ${path}`);
	return write.content;
}

const buildScripts = {
	pnpm: "pnpm with-env tsdown",
	npm: "npm run with-env -- tsdown",
	Yarn: "yarn with-env tsdown",
	Bun: "bun run with-env tsdown",
} as const;

const backends = ["hono", "express", "fastify"] as const;

describe("standalone server scripts", () => {
	it.each(
		backends.flatMap((backend) =>
			(["pnpm", "npm", "Yarn", "Bun"] as const).map((packageManager) => ({
				backend,
				packageManager,
			})),
		),
	)(
		"sets NODE_ENV in the $backend dev and start scripts under $packageManager",
		async ({ backend, packageManager }) => {
			const plan = await plannedProject({
				backend,
				packageManager,
				slug: "acme",
				web: "nextjs",
			});

			const manifest = writeContent(plan, "apps/server/package.json");

			expect(manifest).toContain(
				'"dev": "dotenv -e ../../.env -v NODE_ENV=development -- tsx watch src/index.ts"',
			);

			expect(manifest).toContain(
				'"start": "dotenv -e ../../.env -v NODE_ENV=production -- node dist/index.js"',
			);

			expect(manifest).toContain(`"build": "${buildScripts[packageManager]}"`);
			expect(manifest).toContain('"with-env": "dotenv -e ../../.env --"');
		},
	);
});

describe("NODE_ENV defaults", () => {
	const config: ForgeConfig = {
		authentication: "better-auth",
		authMethods: ["email-password", "email-otp", "magic-link"],
		database: "sqlite",
		emailProvider: "resend",
		orm: "drizzle",
		packageManager: "pnpm",
		slug: "acme",
		web: "nextjs",
	};

	it.each(backends)(
		"treats an unset NODE_ENV as production on the %s server side",
		async (backend) => {
			const plan = await plannedProject({ ...config, backend });
			for (const path of [
				"apps/server/env.ts",
				"packages/auth/env.ts",
				"packages/email/env.ts",
			]) {
				const env = writeContent(plan, path);
				expect(env, path).toContain('.default("production")');
				expect(env, path).not.toContain('.default("development")');
			}

			expect(writeContent(plan, "apps/web/env.ts")).toContain(
				'.default("development")',
			);
		},
	);

	it("keeps secure cookies tied to an explicit development opt in", async () => {
		const plan = await plannedProject({ ...config, backend: "hono" });

		expect(writeContent(plan, "packages/auth/src/index.ts")).toContain(
			'useSecureCookies: env.NODE_ENV !== "development"',
		);
	});
});
