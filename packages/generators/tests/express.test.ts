import { describe, expect, it } from "vitest";
import {
	apiHostError,
	backends,
	builtins,
	expressFramework,
	type ForgeConfig,
	resolveApiHost,
} from "../src";
import { standaloneApiOrigin } from "../src/origins";
import { plannedProject } from "./planner-harness";

const markerPattern = /__[A-Z_]+__/;

function writeContent(
	plan: Awaited<ReturnType<typeof plannedProject>>,
	path: string,
) {
	const write = plan.writes.find((entry) => entry.path === path);
	if (write === undefined) throw new Error(`Missing Write: ${path}`);
	return write.content;
}

describe("Express backend", () => {
	it("exposes Express as an available standalone API host", () => {
		expect(backends.normalize("express")).toBe("express");
		expect(backends.available("express")).toBe(true);
		expect(
			resolveApiHost(
				{ backend: "express", web: "tanstack-router" },
				builtins.frameworks,
			),
		).toBe("server");
		expect(standaloneApiOrigin({ backend: "express" })).toBe(
			"http://localhost:3001",
		);
	});

	it("keeps the standalone server contract configless", () => {
		expect(expressFramework).toMatchObject({
			buildOutputs: ["dist/**"],
			ignoreDirs: [],
			slots: ["api", "trpc", "auth"],
			sourceRoot: "src",
			tsconfigPreset: { name: "express" },
		});
		expect(expressFramework).not.toHaveProperty("configFile");
	});

	it("renders validated startup and graceful shutdown", async () => {
		const plan = await plannedProject({
			backend: "express",
			catalogs: "scoped",
			name: "Acme",
			packageManager: "pnpm",
			platforms: [],
			runtime: "Node.js",
			slug: "acme",
		});

		expect(writeContent(plan, "apps/server/env.ts")).toContain(
			"PORT: z.coerce.number().int().positive().default(3001)",
		);

		const entry = writeContent(plan, "apps/server/src/index.ts");
		expect(entry).toContain("app.listen(env.PORT");
		expect(entry).toContain("server.close(() => process.exit(0))");
		expect(entry).toContain('process.on("SIGINT", shutdown)');
		expect(entry).toContain('process.on("SIGTERM", shutdown)');
	});

	it("renders every tRPC and Better Auth registration combination", async () => {
		const combinations: ReadonlyArray<
			Pick<ForgeConfig, "authentication" | "rpc">
		> = [
			{ authentication: undefined, rpc: undefined },
			{ authentication: undefined, rpc: "trpc" },
			{ authentication: "better-auth", rpc: undefined },
			{ authentication: "better-auth", rpc: "trpc" },
		];

		for (const combination of combinations) {
			const plan = await plannedProject({
				backend: "express",
				catalogs: "scoped",
				...(combination.authentication === undefined
					? {}
					: {
							authentication: combination.authentication,
							database: "sqlite",
							orm: "drizzle",
						}),
				name: "Acme",
				packageManager: "pnpm",
				platforms: ["web"],
				...(combination.rpc === undefined ? {} : { rpc: combination.rpc }),
				runtime: "Node.js",
				slug: "acme",
				web: "nextjs",
			});

			const app = writeContent(plan, "apps/server/src/app.ts");
			expect(app).toContain('import cors from "cors"');
			expect(app).toContain('import express from "express"');
			expect(app).toContain("export const app: Express = express()");
			expect(app).toContain("origin: env.WEB_URL");
			expect(app).toContain('"x-trpc-source"');
			expect(app).not.toMatch(markerPattern);
			expect(app.includes("registerTrpcRoutes(app);")).toBe(
				combination.rpc === "trpc",
			);
			expect(app.includes("registerAuthRoutes(app);")).toBe(
				combination.authentication === "better-auth",
			);

			if (combination.rpc === "trpc") {
				const route = writeContent(plan, "apps/server/src/routes/trpc.ts");
				expect(route).toContain("createExpressMiddleware");
				expect(route).toContain('"/api/trpc"');
				expect(route).toContain("headersFromRequest(req.headers)");
				if (combination.authentication === "better-auth")
					expect(route).toContain(
						"auth,\n          headers: headersFromRequest(req.headers)",
					);
				expect(route).not.toMatch(markerPattern);
			}

			if (combination.authentication === "better-auth") {
				const route = writeContent(plan, "apps/server/src/routes/auth.ts");
				expect(route).toContain("toNodeHandler(auth)");
				expect(route).toContain('app.all("/api/auth/*splat"');
				expect(route).not.toContain("express.json()");
				expect(route).not.toMatch(markerPattern);
			}
		}
	});

	it("keeps web and Expo client contributions byte-identical to Hono", async () => {
		const config: ForgeConfig = {
			authentication: "better-auth",
			catalogs: "scoped",
			database: "sqlite",
			mobile: "expo",
			name: "Acme",
			orm: "drizzle",
			packageManager: "pnpm",
			platforms: ["web", "mobile"],
			rpc: "trpc",
			runtime: "Node.js",
			slug: "acme",
			web: "nextjs",
		};
		const [express, hono] = await Promise.all([
			plannedProject({ ...config, backend: "express" }),
			plannedProject({ ...config, backend: "hono" }),
		]);

		for (const path of [
			"apps/mobile/src/lib/auth-client.ts",
			"apps/mobile/src/lib/trpc.ts",
			"apps/web/trpc/query-client.ts",
			"apps/web/trpc/react.tsx",
			"packages/auth/src/client.ts",
		])
			expect(writeContent(express, path), path).toBe(writeContent(hono, path));
	});

	it("plans Express's API slots without a phantom web module", async () => {
		const plan = await plannedProject({
			authentication: "better-auth",
			backend: "express",
			catalogs: "scoped",
			database: "sqlite",
			name: "Acme",
			orm: "drizzle",
			packageManager: "pnpm",
			platforms: [],
			rpc: "trpc",
			runtime: "Node.js",
			slug: "acme",
		});

		expect(writeContent(plan, "apps/server/forge.json")).toContain(
			'"framework": "express"',
		);
		expect(writeContent(plan, "apps/server/forge.json")).toContain(
			'"trpc": "src/routes/trpc.ts"',
		);
		expect(writeContent(plan, "apps/server/forge.json")).toContain(
			'"auth": "src/routes/auth.ts"',
		);
		expect(Object.values(plan.manifest.modules)).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ root: "apps/server" }),
			]),
		);
		expect(
			plan.writes.some((write) => write.path.startsWith("apps/web/")),
		).toBe(false);
		expect(
			apiHostError(
				{ backend: "express" },
				{ id: "trpc", name: "tRPC" },
				builtins.frameworks,
			),
		).toBeUndefined();
	});
});
