import { describe, expect, it } from "vitest";
import { builtins } from "../src";
import { plannedProject } from "./planner-harness";

const base = {
	catalogs: "flat",
	name: "Acme",
	packageManager: "pnpm",
	runtime: "Node.js",
	slug: "acme",
} as const;

function writeContent(
	plan: Awaited<ReturnType<typeof plannedProject>>,
	path: string,
) {
	const write = plan.writes.find((entry) => entry.path === path);
	if (write === undefined) throw new Error(`Missing Write: ${path}`);
	return write.content;
}

describe("worker addon", () => {
	it("scaffolds the service with health, trigger, and drain", async () => {
		const plan = await plannedProject({
			...base,
			addons: ["worker"],
			platforms: ["web"],
			web: "nextjs",
		});

		expect(plan.writes.map((write) => write.path)).toEqual(
			expect.arrayContaining([
				"apps/worker/env.ts",
				"apps/worker/forge.json",
				"apps/worker/src/app.ts",
				"apps/worker/src/index.ts",
				"apps/worker/src/run.ts",
				"apps/worker/tsdown.config.ts",
			]),
		);

		const app = writeContent(plan, "apps/worker/src/app.ts");
		expect(app).toContain('app.get("/health"');
		expect(app).toContain("bearerAuth({ token: deps.secret })");
		expect(app).toContain("deps.staleAfterMs !== undefined");
		expect(app).not.toMatch(/staleAfterMs\s*\?\?/);

		const entry = writeContent(plan, "apps/worker/src/index.ts");
		expect(entry).toContain("inFlightCount() === 0");
		expect(entry).toContain('process.on("SIGTERM", shutdown)');
		expect(entry).toContain(
			'if ("closeIdleConnections" in server) server.closeIdleConnections()',
		);
		expect(entry).toContain(
			"setTimeout(() => process.exit(1), shutdownTimeoutMs)",
		);

		expect(writeContent(plan, "apps/worker/tsdown.config.ts")).toContain(
			"noExternal: [/^@acme\\//]",
		);
	});

	it("seeds a worker secret into the env files", async () => {
		const plan = await plannedProject({
			...base,
			addons: ["worker"],
			platforms: ["web"],
			web: "nextjs",
		});

		expect(writeContent(plan, ".env")).toMatch(/WORKER_SECRET="[0-9a-f]{64}"/);
		expect(writeContent(plan, ".env.example")).toContain('WORKER_SECRET=""');
	});

	it("composes with a web app, a backend, or neither", async () => {
		for (const config of [
			{ platforms: ["web"], web: "nextjs" },
			{ backend: "hono", platforms: ["web"], web: "nextjs" },
			{ backend: "hono", platforms: [] },
			{ platforms: [] },
		] as const) {
			const plan = await plannedProject({
				...base,
				...config,
				addons: ["worker"],
			});

			expect(
				Object.values(plan.manifest.modules).some(
					(module) => module.root === "apps/worker",
				),
				JSON.stringify(config),
			).toBe(true);
		}
	});

	it("ships the hono tsconfig preset without a hono backend", async () => {
		const plan = await plannedProject({
			...base,
			addons: ["worker"],
			platforms: ["web"],
			web: "nextjs",
		});

		expect(plan.writes.map((write) => write.path)).toContain(
			"tooling/tsconfig/hono.json",
		);
		expect(writeContent(plan, "apps/worker/tsconfig.json")).toContain(
			"@acme/tsconfig/hono.json",
		);
	});

	it("keeps tRPC and Better Auth off the worker", async () => {
		const plan = await plannedProject({
			...base,
			addons: ["worker"],
			authentication: "better-auth",
			backend: "hono",
			database: "sqlite",
			orm: "drizzle",
			platforms: ["web"],
			rpc: "trpc",
			web: "nextjs",
		});

		const serverId = Object.entries(plan.manifest.modules).find(
			([, module]) => module.root === "apps/server",
		)?.[0];

		for (const id of ["trpc", "better-auth"]) {
			const install = plan.manifest.installs.find(
				(entry) => entry.definitionId === id,
			);

			expect(install?.targets, id).toEqual([
				{ kind: "module", moduleId: serverId },
			]);
		}

		expect(
			plan.writes.some((write) =>
				write.path.startsWith("apps/worker/src/routes"),
			),
		).toBe(false);
	});

	it("does not scaffold anything without the addon", async () => {
		const plan = await plannedProject({
			...base,
			platforms: ["web"],
			web: "nextjs",
		});

		expect(
			plan.writes.some((write) => write.path.startsWith("apps/worker/")),
		).toBe(false);
		expect(
			plan.writes.some((write) => write.content.includes("WORKER_SECRET")),
		).toBe(false);
	});

	it("is opt-in, never recommended", () => {
		const entry = builtins.addons.find((addon) => addon.id === "worker");

		expect(entry?.when({ ...base, addons: [] })).toBe(false);
		expect(entry?.when({ ...base, addons: ["worker"] })).toBe(true);
	});
});
