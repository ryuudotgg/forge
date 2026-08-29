import { describe, expect, it } from "vitest";
import {
	apiHostError,
	backends,
	builtins,
	type ForgeConfig,
	fastifyFramework,
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

describe("Fastify backend", () => {
	it("exposes Fastify as an available standalone API host", () => {
		expect(backends.normalize("fastify")).toBe("fastify");
		expect(backends.available("fastify")).toBe(true);
		expect(
			resolveApiHost(
				{ backend: "fastify", web: "tanstack-router" },
				builtins.frameworks,
			),
		).toBe("server");
		expect(standaloneApiOrigin({ backend: "fastify" })).toBe(
			"http://localhost:3001",
		);
	});

	it("keeps the standalone server contract configless", () => {
		expect(fastifyFramework).toMatchObject({
			buildOutputs: ["dist/**"],
			ignoreDirs: [],
			slots: ["api", "trpc", "auth"],
			sourceRoot: "src",
			tsconfigPreset: { name: "fastify" },
		});
		expect(fastifyFramework).not.toHaveProperty("configFile");
	});

	it("renders validated startup and graceful shutdown", async () => {
		const plan = await plannedProject({
			backend: "fastify",
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
		expect(entry).toContain("await app.listen({ port: env.PORT })");
		expect(entry).toContain("await app.close()");
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
				backend: "fastify",
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
			expect(app).toContain('import cors from "@fastify/cors"');
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
				expect(route).toContain("fastifyTRPCPlugin");
				expect(route).toContain('prefix: "/api/trpc"');
				expect(route).toContain("headersFromRequest(req.headers)");
				if (combination.authentication === "better-auth")
					expect(route).toContain(
						"auth,\n          headers: headersFromRequest(req.headers)",
					);
				expect(route).not.toMatch(markerPattern);
			}

			if (combination.authentication === "better-auth") {
				const route = writeContent(plan, "apps/server/src/routes/auth.ts");
				expect(route).toContain('method: ["GET", "POST"]');
				expect(route).toContain('url: "/api/auth/*"');
				expect(route).toContain("async handler(request, reply)");
				expect(route).not.toContain("app.all(");
				expect(route).toContain("fromNodeHeaders(request.headers)");
				expect(route).toContain("await auth.handler(");
				expect(route).toContain("reply.status(response.status)");
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
		const [fastify, hono] = await Promise.all([
			plannedProject({ ...config, backend: "fastify" }),
			plannedProject({ ...config, backend: "hono" }),
		]);

		for (const path of [
			"apps/mobile/src/lib/auth-client.ts",
			"apps/mobile/src/lib/trpc.ts",
			"apps/web/trpc/query-client.ts",
			"apps/web/trpc/react.tsx",
			"packages/auth/src/client.ts",
		])
			expect(writeContent(fastify, path), path).toBe(writeContent(hono, path));
	});

	it("plans Fastify's API slots without a phantom web module", async () => {
		const plan = await plannedProject({
			authentication: "better-auth",
			backend: "fastify",
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
			'"framework": "fastify"',
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
				{ backend: "fastify" },
				{ id: "trpc", name: "tRPC" },
				builtins.frameworks,
			),
		).toBeUndefined();
	});
});
