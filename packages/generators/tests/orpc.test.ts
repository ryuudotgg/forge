import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createRouterClient, ORPCError, onError, type os } from "@orpc/server";
import { RPCHandler } from "@orpc/server/fetch";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	apiHostError,
	type ForgeConfig,
	rpcConsumer,
	rpcProviderError,
} from "../src";
import { rpcProviderTemplate } from "../src/rpc";
import { plannedProject } from "./planner-harness";

const supportedConfig: ForgeConfig = {
	slug: "acme",
	backend: "hono",
	web: "tanstack-router",
	rpc: "orpc",
	packageManager: "pnpm",
};

function writeContent(
	plan: Awaited<ReturnType<typeof plannedProject>>,
	path: string,
) {
	const write = plan.writes.find((entry) => entry.path === path);
	if (write === undefined) throw new Error(`Missing Write: ${path}`);
	return write.content;
}

describe("oRPC on Hono with TanStack Router", () => {
	it.each([false, true])(
		"renders the supported pair with auth and db: %s",
		async (usesAuth) => {
			const config: ForgeConfig = usesAuth
				? {
						...supportedConfig,
						authentication: "better-auth",
						orm: "drizzle",
						database: "sqlite",
					}
				: supportedConfig;

			const plan = await plannedProject(config);
			for (const path of [
				"packages/orpc/src/orpc.ts",
				"packages/orpc/src/router.ts",
				"packages/orpc/src/index.ts",
				"apps/server/src/routes/orpc.ts",
				"apps/web/src/orpc/client.ts",
				"apps/web/src/orpc/react.tsx",
			])
				expect(writeContent(plan, path), path).not.toBe("");

			const app = writeContent(plan, "apps/server/src/app.ts");
			expect(app).toContain('import { orpcRoutes } from "./routes/orpc.js";');
			expect(app).toContain('app.route("/", orpcRoutes);');

			const providers = writeContent(plan, "apps/web/src/providers.tsx");
			expect(providers).toContain("orpc?: ElementType");
			expect(providers).toContain("orpc: ORPCReactProvider");
			expect(providers).toContain("dataProviders.orpc");
			expect(providers).not.toContain("dataProviders.trpc");
			expect(
				JSON.parse(writeContent(plan, "apps/server/forge.json")),
			).toMatchObject({
				slots: {
					api: "src/routes",
					trpc: "src/routes/trpc.ts",
					auth: "src/routes/auth.ts",
					orpc: "src/routes/orpc.ts",
				},
			});

			const server = JSON.parse(writeContent(plan, "apps/server/package.json"));
			expect(server.dependencies).toMatchObject({
				"@acme/orpc": "workspace:*",
				"@orpc/server": "catalog:",
			});

			const web = JSON.parse(writeContent(plan, "apps/web/package.json"));
			expect(web.dependencies).toMatchObject({
				"@acme/orpc": "workspace:*",
				"@orpc/client": "catalog:",
				"@orpc/server": "catalog:",
				"@orpc/tanstack-query": "catalog:",
				"@tanstack/react-query": "catalog:",
			});

			const rpc = JSON.parse(writeContent(plan, "packages/orpc/package.json"));
			expect(rpc).toMatchObject({
				name: "@acme/orpc",
				exports: { ".": "./src/index.ts" },
				dependencies: { "@orpc/server": "catalog:" },
				devDependencies: {
					"@acme/tsconfig": "workspace:*",
					"@types/node": "catalog:",
					typescript: "catalog:",
				},
			});

			expect(rpc.dependencies["@acme/auth"]).toBe(
				usesAuth ? "workspace:*" : undefined,
			);

			expect(rpc.dependencies["@acme/db"]).toBe(
				usesAuth ? "workspace:*" : undefined,
			);

			const context = writeContent(plan, "packages/orpc/src/orpc.ts");
			expect(context.includes('import { db } from "@acme/db/client"')).toBe(
				usesAuth,
			);

			expect(context.includes("auth.api.getSession({ headers })")).toBe(
				usesAuth,
			);

			expect(context).toContain('throw new ORPCError("UNAUTHORIZED")');
			const router = writeContent(plan, "packages/orpc/src/router.ts");
			expect(router.includes("me: protectedProcedure.handler")).toBe(usesAuth);
			expect(router).toContain(
				'health: publicProcedure.handler(() => ({ status: "ok" as const }))',
			);

			const route = writeContent(plan, "apps/server/src/routes/orpc.ts");
			expect(route).toContain(
				'import { BodyLimitPlugin, RPCHandler } from "@orpc/server/fetch"',
			);

			expect(route).toContain(
				"new BodyLimitPlugin({ maxBodySize: 1024 * 1024 })",
			);

			expect(route).toContain("SimpleCsrfProtectionHandlerPlugin");
			expect(route).toContain('prefix: "/api/orpc"');
			expect(route).toContain("c.newResponse(response.body, response)");
			expect(route).toContain("context: { headers: c.req.raw.headers }");

			const client = writeContent(plan, "apps/web/src/orpc/client.ts");
			expect(client).toContain('import { env } from "../../env"');
			expect(client).toContain(`\`\${env.VITE_SERVER_URL}/api/orpc\``);

			expect(client).toContain('credentials: "include"');
			expect(client).toContain("SimpleCsrfProtectionLinkPlugin");
			expect(client).toContain("createTanstackQueryUtils(client)");

			expect(writeContent(plan, "apps/web/src/orpc/react.tsx")).toContain(
				"staleTime: 30 * 1000",
			);

			expect(writeContent(plan, "pnpm-workspace.yaml")).toContain(
				"@orpc/server",
			);

			for (const write of plan.writes)
				expect(write.content, write.path).not.toMatch(/__[A-Z_]+__/);
		},
	);

	it("puts the database in the context without auth", async () => {
		const plan = await plannedProject({
			...supportedConfig,
			orm: "drizzle",
			database: "sqlite",
		});

		const context = writeContent(plan, "packages/orpc/src/orpc.ts");
		expect(context).toContain('import { db } from "@acme/db/client"');
		expect(context).toContain("next({ context: { db, session } })");
		expect(context).toContain("return null;");
		expect(writeContent(plan, "packages/orpc/src/router.ts")).not.toContain(
			"me:",
		);
	});
});

describe("oRPC on Express and Fastify", () => {
	it.each([
		{ backend: "express", entrypoint: "node" },
		{ backend: "fastify", entrypoint: "fastify" },
	] satisfies ReadonlyArray<{
		backend: ForgeConfig["backend"];
		entrypoint: string;
	}>)(
		"renders $backend with and without auth",
		async ({ backend, entrypoint }) => {
			for (const usesAuth of [false, true]) {
				const plan = await plannedProject({
					...supportedConfig,
					backend,
					...(usesAuth
						? ({
								authentication: "better-auth",
								orm: "drizzle",
								database: "sqlite",
							} satisfies Partial<ForgeConfig>)
						: {}),
				});

				expect(
					JSON.parse(writeContent(plan, "apps/server/forge.json")),
				).toMatchObject({
					framework: backend,
					slots: { orpc: "src/routes/orpc.ts" },
				});

				const app = writeContent(plan, "apps/server/src/app.ts");
				expect(app).toContain(
					'import { registerOrpcRoutes } from "./routes/orpc.js"',
				);

				expect(app).toContain("registerOrpcRoutes(app);");
				expect(app).toContain('"x-csrf-token"');
				expect(app).not.toContain("x-trpc-source");
				expect(app).not.toContain("registerTrpcRoutes");

				expect(app).toContain("credentials: true");
				expect(app.includes("registerAuthRoutes(app);")).toBe(usesAuth);

				const route = writeContent(plan, "apps/server/src/routes/orpc.ts");
				expect(route).toContain(
					`import { ${backend === "express" ? "BodyLimitPlugin, " : ""}RPCHandler } from "@orpc/server/${entrypoint}"`,
				);

				expect(route).toContain("new RPCHandler(appRouter");
				expect(route).toContain("SimpleCsrfProtectionHandlerPlugin");
				expect(route).toContain('prefix: "/api/orpc"');

				expect(route).toContain("headers: headersFromRequest(request.headers)");
				expect(route).toContain("const result = new Headers()");
				expect(route).toContain("Object.entries(headers)");
				expect(route).toContain("if (value === undefined) continue");

				expect(route).toContain("Array.isArray(value)");
				expect(route).toContain("result.append(name, item)");
				expect(route).toContain("result.set(name, value)");
				expect(route).toContain("return result;");

				if (backend === "express") {
					expect(route).toContain(
						"new BodyLimitPlugin({ maxBodySize: 1024 * 1024 })",
					);

					expect(route).toContain("app.use(async (request, response, next)");
					expect(route).toContain("handler.handle(request, response");
					expect(route).toContain("if (!matched) next()");
				} else {
					expect(route).toContain("const maxBodySize = 1024 * 1024;");
					expect(route).toContain('throw new ORPCError("PAYLOAD_TOO_LARGE")');
					expect(route).toContain("received > maxBodySize");
					expect(route).toContain("adapterInterceptors: [");
					expect(route).toContain("return await options.next();");
					expect(route).toContain("raw.emit = emit;");

					expect(route).toContain("scope.removeAllContentTypeParsers()");
					expect(route).toContain('method: ["GET", "POST"]');
					expect(route).toContain('url: "/api/orpc/*"');
					expect(route).toContain("handler.handle(request, reply");
					expect(route).toContain("if (!matched) reply.callNotFound()");
				}

				const server = JSON.parse(
					writeContent(plan, "apps/server/package.json"),
				);

				expect(server.dependencies).toMatchObject({
					"@acme/orpc": "workspace:*",
					"@orpc/server": "catalog:",
				});

				expect(server.dependencies).not.toHaveProperty("@acme/trpc");
				expect(server.dependencies).not.toHaveProperty("@trpc/server");

				const rpc = JSON.parse(
					writeContent(plan, "packages/orpc/package.json"),
				);

				expect(rpc).toMatchObject({
					name: "@acme/orpc",
					exports: { ".": "./src/index.ts" },
					dependencies: { "@orpc/server": "catalog:" },
				});

				expect(rpc.dependencies["@acme/auth"]).toBe(
					usesAuth ? "workspace:*" : undefined,
				);

				expect(rpc.dependencies["@acme/db"]).toBe(
					usesAuth ? "workspace:*" : undefined,
				);

				const client = writeContent(plan, "apps/web/src/orpc/client.ts");
				expect(client).toContain('import type { AppRouter } from "@acme/orpc"');
				expect(client).toContain("RouterClient<AppRouter>");
				expect(client).toContain(`\`\${env.VITE_SERVER_URL}/api/orpc\``);

				expect(client).toContain('credentials: "include"');
				expect(client).toContain("SimpleCsrfProtectionLinkPlugin");
				expect(client).toContain("createTanstackQueryUtils(client)");

				const web = JSON.parse(writeContent(plan, "apps/web/package.json"));

				expect(web.dependencies).toMatchObject({
					"@acme/orpc": "workspace:*",
					"@orpc/client": "catalog:",
					"@orpc/server": "catalog:",
					"@orpc/tanstack-query": "catalog:",
					"@tanstack/react-query": "catalog:",
				});

				const providers = writeContent(plan, "apps/web/src/providers.tsx");
				expect(providers).toContain("orpc: ORPCReactProvider");
				expect(providers).toContain("dataProviders.orpc");
				expect(providers).not.toContain("dataProviders.trpc");
				expect(writeContent(plan, "apps/web/src/orpc/react.tsx")).toContain(
					"QueryClientProvider",
				);

				for (const write of plan.writes)
					expect(write.content, write.path).not.toMatch(/__[A-Z_]+__/);
			}
		},
	);

	it.each(["express", "fastify"] satisfies ReadonlyArray<
		ForgeConfig["backend"]
	>)("preserves $backend tRPC and no RPC output", async (backend) => {
		for (const rpc of [undefined, "trpc"] satisfies ReadonlyArray<
			ForgeConfig["rpc"]
		>) {
			const plan = await plannedProject({ ...supportedConfig, backend, rpc });

			const app = writeContent(plan, "apps/server/src/app.ts");
			expect(app).toContain('"x-trpc-source"');
			expect(app).not.toContain("x-csrf-token");
			expect(app).not.toContain("registerOrpcRoutes");
			expect(app.includes("registerTrpcRoutes(app);")).toBe(rpc === "trpc");
			expect(
				JSON.parse(writeContent(plan, "apps/server/forge.json")).slots,
			).not.toHaveProperty("orpc");

			expect(plan.writes.some((write) => write.path.includes("/orpc/"))).toBe(
				false,
			);
		}
	});
});

describe("oRPC web clients beside Hono", () => {
	it.each([
		{ web: "nextjs", sourceRoot: "", prefix: "NEXT_PUBLIC_" },
		{ web: "react-router", sourceRoot: "app/", prefix: "VITE_" },
		{ web: "tanstack-start", sourceRoot: "src/", prefix: "VITE_" },
	] satisfies ReadonlyArray<{
		web: ForgeConfig["web"];
		sourceRoot: string;
		prefix: string;
	}>)(
		"renders a typed $web client with and without auth",
		async ({ web, sourceRoot, prefix }) => {
			for (const usesAuth of [false, true]) {
				const plan = await plannedProject({
					...supportedConfig,
					web,
					...(usesAuth
						? ({
								authentication: "better-auth",
								orm: "drizzle",
								database: "sqlite",
							} satisfies Partial<ForgeConfig>)
						: {}),
				});

				const client = writeContent(
					plan,
					`apps/web/${sourceRoot}orpc/client.ts`,
				);

				expect(client).toContain('import type { AppRouter } from "@acme/orpc"');
				expect(client).toContain(
					"export const client: RouterClient<AppRouter>",
				);

				expect(client).toContain(
					"export const orpc = createTanstackQueryUtils(client)",
				);

				expect(client).toContain(`env.${prefix}SERVER_URL`);
				expect(client).toContain(
					web === "nextjs" ? 'from "../env"' : 'from "../../env"',
				);

				expect(client).toContain('credentials: "include"');
				expect(client).toContain("SimpleCsrfProtectionLinkPlugin");

				if (web !== "nextjs")
					expect(writeContent(plan, "apps/web/env.ts")).toContain(
						'typeof process === "undefined" ? {} : process.env',
					);

				const provider = writeContent(
					plan,
					`apps/web/${sourceRoot}orpc/react.tsx`,
				);

				expect(provider).toContain("QueryClientProvider");
				if (web === "nextjs") expect(provider).toMatch(/^"use client";/);

				const providers = writeContent(
					plan,
					`apps/web/${web === "tanstack-start" ? "src" : "app"}/providers.tsx`,
				);

				expect(providers).toContain(
					'import { ORPCReactProvider } from "@/orpc/react"',
				);

				expect(providers).not.toContain("dataProviders.trpc");
				if (web !== "nextjs") expect(providers).toContain("dataProviders.orpc");

				if (web === "react-router")
					expect(writeContent(plan, "apps/web/app/routes.ts")).not.toMatch(
						/api\/(orpc|auth)/,
					);

				const manifest = JSON.parse(
					writeContent(plan, "apps/web/package.json"),
				);

				expect(manifest.dependencies).toMatchObject({
					"@acme/orpc": "workspace:*",
					"@orpc/client": "catalog:",
					"@orpc/server": "catalog:",
					"@orpc/tanstack-query": "catalog:",
					"@tanstack/react-query": "catalog:",
				});

				expect(
					plan.writes.some((write) =>
						write.path.startsWith(`apps/web/${sourceRoot}orpc/server`),
					),
				).toBe(false);

				expect(
					plan.writes.some(
						(write) =>
							write.path.startsWith("apps/web/") &&
							write.path.includes("api/orpc"),
					),
				).toBe(false);

				for (const write of plan.writes)
					expect(write.content, write.path).not.toMatch(/__[A-Z_]+__/);
			}
		},
	);
});

describe("oRPC Next.js self host", () => {
	it.each([false, true])(
		"renders request scoped RSC with auth: %s",
		async (usesAuth) => {
			for (const backend of [undefined, "self"] satisfies ReadonlyArray<
				ForgeConfig["backend"]
			>) {
				const config: ForgeConfig = {
					...supportedConfig,
					backend,
					web: "nextjs",
					name: "Acme",
					...(usesAuth
						? ({
								authentication: "better-auth",
								orm: "drizzle",
								database: "sqlite",
							} satisfies Partial<ForgeConfig>)
						: {}),
				};

				const plan = await plannedProject(config);
				const defaultPlan = await plannedProject({ ...config, rpc: undefined });

				expect(writeContent(plan, "apps/web/app/page.tsx")).toBe(
					writeContent(defaultPlan, "apps/web/app/page.tsx"),
				);

				const server = writeContent(plan, "apps/web/orpc/server.ts");
				const route = writeContent(
					plan,
					"apps/web/app/api/orpc/[[...rest]]/route.ts",
				);

				const client = writeContent(plan, "apps/web/orpc/client.ts");
				const page = writeContent(plan, "apps/web/app/orpc-example/page.tsx");
				const health = writeContent(plan, "apps/web/orpc/health.tsx");

				expect(server).not.toContain("server-only");
				expect(server).toContain(
					"globalThis.$client = createRouterClient(appRouter, {",
				);

				expect(server).toContain(
					'const { headers } = await import("next/headers");',
				);

				expect(server).not.toMatch(/^import .*next\/headers/m);
				expect(server).toContain("return { headers: await headers() };");

				expect(server).not.toContain('from "./client"');

				expect(route).toContain("SimpleCsrfProtectionHandlerPlugin");
				expect(route).toContain("headers: request.headers");
				expect(route).toContain('prefix: "/api/orpc"');

				for (const method of ["HEAD", "GET", "POST", "PUT", "PATCH", "DELETE"])
					expect(route).toContain(`export const ${method} = handler;`);

				expect(route).toContain('new Response("Not Found", { status: 404 })');

				expect(client).not.toContain('"use client"');
				expect(client).toContain(
					'if (typeof window === "undefined") await import("./server");',
				);

				expect(client).toContain(
					"var $client: RouterClient<AppRouter> | undefined;",
				);

				expect(client).toContain(
					"export const client: RouterClient<AppRouter> =\n  globalThis.$client ?? createORPCClient(link);",
				);

				expect(client).toContain(
					'new URL("/api/orpc", window.location.origin)',
				);

				expect(client).toContain("SimpleCsrfProtectionLinkPlugin");

				for (const content of [
					client,
					health,
					writeContent(plan, "apps/web/orpc/react.tsx"),
				]) {
					expect(content).not.toMatch(
						/next\/headers|server-only|createORPCContext|import \{ auth \}/,
					);

					expect(content).not.toContain(
						'from "@acme/orpc";\nimport { appRouter',
					);
				}

				expect(page).not.toContain('"use client"');
				expect(page).toContain(
					'import {\n  dehydrate,\n  HydrationBoundary,\n  QueryClient,\n} from "@tanstack/react-query";\n',
				);

				expect(page).toContain('import { orpc } from "@/orpc/client";');
				expect(page).not.toContain("createServerORPC");
				expect(page).toContain("export default async function Page()");
				expect(page).toContain("const queryClient = new QueryClient()");
				expect(page).toContain(
					"await queryClient.prefetchQuery(orpc.health.queryOptions())",
				);

				expect(page).toContain(
					"<HydrationBoundary state={dehydrate(queryClient)}>",
				);

				expect(page).toContain(
					'className="text-4xl font-bold tracking-tight">Acme</h1>',
				);

				expect(page).not.toMatch(/data\.status|\.health\.call\(/);
				expect(health).toContain("useQuery(orpc.health.queryOptions())");
				expect(health).toContain('data-testid="orpc-health"');

				const provider = writeContent(plan, "apps/web/orpc/react.tsx");
				expect(provider).toMatch(/^"use client";/);
				expect(provider).toContain("staleTime: 30 * 1000");
				expect(provider).not.toContain("useState");
				expect(provider).toContain(
					'if (typeof window === "undefined") return createQueryClient();',
				);

				expect(provider).toContain(
					"browserQueryClient ??= createQueryClient();",
				);

				expect(provider).toContain("const queryClient = getQueryClient();");

				expect(writeContent(plan, "apps/web/app/providers.tsx")).toContain(
					"<ORPCReactProvider>{children}</ORPCReactProvider>",
				);

				expect(
					JSON.parse(writeContent(plan, "apps/web/package.json")).dependencies,
				).toMatchObject({
					"@acme/orpc": "workspace:*",
					"@orpc/client": "catalog:",
					"@orpc/server": "catalog:",
					"@orpc/tanstack-query": "catalog:",
					"@tanstack/react-query": "catalog:",
					"server-only": "catalog:",
				});

				expect(
					JSON.parse(writeContent(plan, "apps/web/forge.json")).slots.orpc,
				).toBe("app/api/orpc/[[...rest]]/route.ts");

				expect(
					plan.writes.some((write) => write.path.startsWith("apps/server/")),
				).toBe(false);

				for (const write of plan.writes)
					expect(write.content, write.path).not.toMatch(/__[A-Z_]+__/);
			}
		},
	);

	it("renders the client and provider from the React Router templates", async () => {
		const nextjs = await plannedProject({
			...supportedConfig,
			backend: "self",
			web: "nextjs",
		});

		const reactRouter = await plannedProject({
			...supportedConfig,
			backend: "self",
			web: "react-router",
		});

		const browserClient = writeContent(nextjs, "apps/web/orpc/client.ts")
			.replace(
				'\ndeclare global {\n  var $client: RouterClient<AppRouter> | undefined;\n}\n\nif (typeof window === "undefined") await import("./server");\n',
				"",
			)
			.replace(
				"=\n  globalThis.$client ?? createORPCClient",
				"= createORPCClient",
			);

		expect(browserClient).toBe(
			writeContent(reactRouter, "apps/web/app/orpc/client.ts"),
		);

		expect(writeContent(nextjs, "apps/web/orpc/react.tsx")).toBe(
			`"use client";\n\n${writeContent(reactRouter, "apps/web/app/orpc/react.tsx")}`,
		);
	});

	it.each(["hono", "express", "fastify"] satisfies ReadonlyArray<
		ForgeConfig["backend"]
	>)("records no orpc slot when Next.js is a client of %s", async (backend) => {
		const plan = await plannedProject({
			...supportedConfig,
			backend,
			web: "nextjs",
		});

		expect(
			JSON.parse(writeContent(plan, "apps/web/forge.json")).slots,
		).not.toHaveProperty("orpc");

		expect(
			JSON.parse(writeContent(plan, "apps/server/forge.json")).slots.orpc,
		).toBe("src/routes/orpc.ts");
	});

	it.each([undefined, "trpc"] satisfies ReadonlyArray<ForgeConfig["rpc"]>)(
		"preserves legacy Next.js slots for %s",
		async (rpc) => {
			const plan = await plannedProject({
				...supportedConfig,
				backend: "self",
				web: "nextjs",
				rpc,
			});

			const manifest = JSON.parse(writeContent(plan, "apps/web/forge.json"));

			expect(manifest.slots).toEqual({
				layout: "app/layout.tsx",
				page: "app/page.tsx",
				api: "app/api",
				trpc: "app/api/trpc/[trpc]/route.ts",
				auth: "app/api/auth/[...all]/route.ts",
			});

			expect(writeContent(plan, "apps/web/app/page.tsx")).not.toContain(
				"Health",
			);

			expect(plan.writes.some((write) => write.path.includes("/orpc/"))).toBe(
				false,
			);
		},
	);

	it.each([false, true])(
		"keeps secondary client CORS with auth: %s",
		async (usesAuth) => {
			const plan = await plannedProject({
				...supportedConfig,
				backend: "self",
				web: "nextjs",
				webApps: [{ name: "admin", framework: "nextjs", client: true }],
				...(usesAuth
					? ({
							authentication: "better-auth",
							orm: "drizzle",
							database: "sqlite",
						} satisfies Partial<ForgeConfig>)
					: {}),
			});

			const proxy = writeContent(plan, "apps/web/proxy.ts");
			const cors = writeContent(plan, "apps/web/lib/api-cors.ts");

			expect(proxy).toContain('"/api/orpc/:path*"');
			expect(proxy).not.toContain('"/api/trpc/:path*"');
			expect(proxy).toContain("withCors(request, NextResponse.next())");
			expect(cors).toContain(
				'headers.set("Access-Control-Allow-Credentials", "true");',
			);

			expect(cors).toContain("x-csrf-token");
			expect(cors).toContain("status: 204");
			expect(writeContent(plan, "apps/admin/orpc/client.ts")).toContain(
				"env.NEXT_PUBLIC_SERVER_URL",
			);

			expect(
				plan.writes.some((write) => write.path === "apps/admin/orpc/server.ts"),
			).toBe(false);

			expect(
				JSON.parse(writeContent(plan, "apps/admin/forge.json")).slots.orpc,
			).toBeUndefined();

			expect(writeContent(plan, "apps/web/next.config.ts")).toContain(
				'"@acme/orpc"',
			);
		},
	);
});

describe("oRPC request hosts", () => {
	it.each(["react-router", "tanstack-start"] satisfies ReadonlyArray<
		ForgeConfig["web"]
	>)(
		"leaves $web legacy module slots and environment unchanged",
		async (web) => {
			for (const rpc of [undefined, "trpc"] satisfies ReadonlyArray<
				ForgeConfig["rpc"]
			>) {
				const plan = await plannedProject({
					...supportedConfig,
					backend: "self",
					web,
					rpc,
				});

				const manifest = JSON.parse(writeContent(plan, "apps/web/forge.json"));

				expect(manifest.slots).not.toHaveProperty("orpc");
				expect(manifest.slots.trpc).toBe(
					web === "react-router"
						? "app/routes/api.trpc.$.ts"
						: "src/routes/api/trpc/$.ts",
				);

				expect(writeContent(plan, "apps/web/env.ts")).not.toContain(
					"VITE_SERVER_URL",
				);

				expect(plan.writes.some((write) => write.path.includes("/orpc/"))).toBe(
					false,
				);
			}
		},
	);

	it.each([
		{
			web: "react-router",
			sourceRoot: "app",
			route: "app/routes/api.orpc.$.ts",
		},
		{
			web: "tanstack-start",
			sourceRoot: "src",
			route: "src/routes/api/orpc/$.ts",
		},
	] satisfies ReadonlyArray<{
		web: ForgeConfig["web"];
		sourceRoot: string;
		route: string;
	}>)(
		"renders $web request routes and callers with auth on and off",
		async ({ web, sourceRoot, route }) => {
			for (const usesAuth of [false, true]) {
				const plan = await plannedProject({
					...supportedConfig,
					backend: "self",
					web,
					...(usesAuth
						? ({
								authentication: "better-auth",
								orm: "drizzle",
								database: "sqlite",
							} satisfies Partial<ForgeConfig>)
						: {}),
				});

				const routeContent = writeContent(plan, `apps/web/${route}`);
				const caller = writeContent(
					plan,
					`apps/web/${sourceRoot}/orpc/server.ts`,
				);

				const client = writeContent(
					plan,
					`apps/web/${sourceRoot}/orpc/client.ts`,
				);

				const providers = writeContent(
					plan,
					`apps/web/${sourceRoot}/providers.tsx`,
				);

				expect(routeContent).toContain('from "@orpc/server/fetch"');
				expect(routeContent).toContain("SimpleCsrfProtectionHandlerPlugin");
				expect(routeContent).toContain('prefix: "/api/orpc"');
				expect(routeContent).toContain("if (matched) return response");
				expect(routeContent).toContain(
					'new Response("Not Found", { status: 404 })',
				);

				expect(routeContent).toContain("headers: request.headers");
				expect(caller).toContain("createServerCaller(request: Request)");
				expect(caller).toContain("createRouterClient(appRouter, {");
				expect(caller).toContain("context: { headers: request.headers }");

				expect(client).toContain("RouterClient<AppRouter>");
				expect(client).toContain(
					'new URL("/api/orpc", window.location.origin)',
				);

				expect(client).toContain('credentials: "include"');
				expect(client).toContain("SimpleCsrfProtectionLinkPlugin");
				expect(writeContent(plan, "apps/web/env.ts")).not.toContain(
					"VITE_SERVER_URL",
				);

				expect(
					writeContent(plan, `apps/web/${sourceRoot}/orpc/react.tsx`),
				).toContain("QueryClientProvider");

				expect(providers).toContain("orpc: ORPCReactProvider");
				expect(providers).toContain("dataProviders.orpc");
				expect(providers).not.toContain("dataProviders.trpc");
				expect(
					JSON.parse(writeContent(plan, "apps/web/package.json")).dependencies,
				).toMatchObject({
					"@acme/orpc": "workspace:*",
					"@orpc/client": "catalog:",
					"@orpc/server": "catalog:",
					"@orpc/tanstack-query": "catalog:",
					"@tanstack/react-query": "catalog:",
				});

				expect(
					JSON.parse(writeContent(plan, "apps/web/forge.json")),
				).toMatchObject({
					framework: web,
					slots: { orpc: route },
				});

				expect(
					Object.values(plan.manifest.modules).find(
						(module) => module.root === "apps/web",
					)?.definitionIds,
				).toContain(`${web}/base`);

				expect(
					plan.writes.some((write) => write.path.startsWith("apps/server/")),
				).toBe(false);

				if (web === "react-router") {
					expect(routeContent).toContain("export const loader");
					expect(routeContent).toContain("export const action");
					expect(writeContent(plan, "apps/web/app/routes.ts")).toContain(
						'route("api/orpc/*", "routes/api.orpc.$.ts")',
					);
				} else {
					expect(routeContent).toContain('import "@tanstack/react-start"');
					expect(routeContent).toContain('createFileRoute("/api/orpc/$")');
					expect(routeContent).toContain("GET: handler");
					expect(routeContent).toContain("POST: handler");
				}

				for (const write of plan.writes)
					expect(write.content, write.path).not.toMatch(/__[A-Z_]+__/);
			}
		},
	);
});

describe("oRPC TanStack Start loaders", () => {
	it.each([false, true])(
		"calls the router in process during server rendering with auth: %s",
		async (usesAuth) => {
			const plan = await plannedProject({
				...supportedConfig,
				backend: "self",
				web: "tanstack-start",
				...(usesAuth
					? ({
							authentication: "better-auth",
							orm: "drizzle",
							database: "sqlite",
						} satisfies Partial<ForgeConfig>)
					: {}),
			});

			const client = writeContent(plan, "apps/web/src/orpc/client.ts");
			const example = writeContent(
				plan,
				"apps/web/src/routes/orpc-example.tsx",
			);

			expect(client).toContain("createIsomorphicFn()");
			expect(client).toContain(
				'import { getRequest } from "@tanstack/react-start/server"',
			);

			expect(client).toContain("createRouterClient(appRouter, {");
			expect(client).toContain(
				"context: () => ({ headers: getRequest().headers })",
			);

			expect(client).toContain('new URL("/api/orpc", window.location.origin)');

			expect(example).toContain('createFileRoute("/orpc-example")');
			expect(example).toContain("loader: ");
			expect(example).toContain('import { client } from "../orpc/client"');
			expect(example).toContain(usesAuth ? "client.me()" : "client.health()");

			expect(example).toContain(
				usesAuth ? 'data-testid="orpc-me"' : 'data-testid="orpc-health"',
			);

			for (const write of plan.writes)
				expect(write.content, write.path).not.toMatch(/__[A-Z_]+__/);
		},
	);

	it("keeps the React Router browser client and loader caller", async () => {
		const plan = await plannedProject({
			...supportedConfig,
			backend: "self",
			web: "react-router",
			authentication: "better-auth",
			orm: "drizzle",
			database: "sqlite",
		});

		expect(writeContent(plan, "apps/web/app/orpc/client.ts")).not.toContain(
			"createIsomorphicFn",
		);

		expect(writeContent(plan, "apps/web/app/orpc/server.ts")).toContain(
			"createServerCaller(request: Request)",
		);

		expect(
			plan.writes.some((write) => write.path.includes("orpc-example")),
		).toBe(false);
	});
});

const orpcHosts = [
	{
		host: "Hono",
		config: { backend: "hono", web: "tanstack-router" },
		route: "apps/server/src/routes/orpc.ts",
	},
	{
		host: "Express",
		config: { backend: "express", web: "tanstack-router" },
		route: "apps/server/src/routes/orpc.ts",
	},
	{
		host: "Fastify",
		config: { backend: "fastify", web: "tanstack-router" },
		route: "apps/server/src/routes/orpc.ts",
	},
	{
		host: "Next.js",
		config: { backend: "self", web: "nextjs" },
		route: "apps/web/app/api/orpc/[[...rest]]/route.ts",
		caller: "apps/web/orpc/server.ts",
	},
	{
		host: "React Router",
		config: { backend: "self", web: "react-router" },
		route: "apps/web/app/routes/api.orpc.$.ts",
		caller: "apps/web/app/orpc/server.ts",
	},
	{
		host: "TanStack Start",
		config: { backend: "self", web: "tanstack-start" },
		route: "apps/web/src/routes/api/orpc/$.ts",
		caller: "apps/web/src/orpc/client.ts",
	},
] satisfies ReadonlyArray<{
	host: string;
	config: ForgeConfig;
	route: string;
	caller?: string;
}>;

const orpcHostCases = orpcHosts.flatMap((entry) =>
	[false, true].map((usesAuth) => ({ ...entry, usesAuth })),
);

function plannedOrpcHost(config: ForgeConfig, usesAuth: boolean) {
	return plannedProject({
		...supportedConfig,
		...config,
		...(usesAuth
			? ({
					authentication: "better-auth",
					orm: "drizzle",
					database: "sqlite",
				} satisfies Partial<ForgeConfig>)
			: {}),
	});
}

describe("oRPC route bodies and errors", () => {
	it("hands Fastify request bodies to oRPC unparsed beside Better Auth", async () => {
		const plan = await plannedOrpcHost(
			{ backend: "fastify", web: "tanstack-router" },
			true,
		);

		const route = writeContent(plan, "apps/server/src/routes/orpc.ts");
		const scope = route.indexOf("app.register(async (scope) => {");

		expect(scope).toBeGreaterThan(-1);
		expect(
			route.indexOf("scope.removeAllContentTypeParsers();"),
		).toBeGreaterThan(scope);

		expect(route).toContain(
			'scope.addContentTypeParser("*", (_request, _payload, done) =>',
		);

		expect(route).toContain("done(null, undefined)");
		expect(route).not.toContain("parseAs");
		expect(route).toContain("scope.route({");
		expect(route).not.toContain("app.route(");
		expect(writeContent(plan, "apps/server/src/routes/auth.ts")).toContain(
			'{ parseAs: "buffer" }',
		);
	});

	it.each(orpcHostCases)(
		"lets oRPC encode and log $host context failures with auth: $usesAuth",
		async ({ config, route, usesAuth }) => {
			const plan = await plannedOrpcHost(config, usesAuth);
			const content = writeContent(plan, route);

			expect(content).not.toContain("createORPCContext");
			expect(content).toMatch(/context: \{\s*headers: /);
			expect(content).toContain(
				'import { appRouter, reportServerError } from "@acme/orpc"',
			);

			expect(content).toMatch(
				/import \{ (ORPCError, )?onError \} from "@orpc\/server"/,
			);
			expect(content).toMatch(
				/interceptors: \[\s*onError\(\(error, \{ request \}\) =>\s*reportServerError\(error, request\.url\.pathname\),?\s*\),?\s*\]/,
			);

			const orpc = writeContent(plan, "packages/orpc/src/orpc.ts");
			expect(orpc).toContain(
				"export function reportServerError(error: unknown, path: string)",
			);

			expect(orpc).toContain(
				`console.error(\`❌ oRPC failed on \${path}:\`, error)`,
			);

			expect(orpc).toMatch(
				/\} catch \(error\) \{\s*if \(error instanceof ORPCError && error\.status < 500\) throw error;\s*reportServerError\(error, path\.join\("\."\)\);\s*throw reported\(error\);/,
			);

			expect(writeContent(plan, "packages/orpc/src/index.ts")).toContain(
				'export { protectedProcedure, publicProcedure, reportServerError } from "./orpc";\n',
			);
		},
	);

	it.each(orpcHostCases)(
		"resolves the session only inside matched $host procedures with auth: $usesAuth",
		async ({ config, route, caller, usesAuth }) => {
			const plan = await plannedOrpcHost(config, usesAuth);
			const orpc = writeContent(plan, "packages/orpc/src/orpc.ts");
			const middleware = orpc.indexOf(
				"export const publicProcedure = os\n  .$context<{ headers: Headers }>()\n  .use(async ({ context, path, next }) => {",
			);

			expect(middleware).toBeGreaterThan(-1);
			expect(orpc).not.toContain("createORPCContext");
			expect(orpc.match(/getSession\(/g)?.length).toBe(
				usesAuth ? 1 : undefined,
			);

			expect(orpc).toContain(
				usesAuth ? "return auth.api.getSession({ headers });" : "return null;",
			);

			expect(
				orpc.indexOf(
					"const session = await resolveSession(context.headers);",
					middleware,
				),
			).toBeGreaterThan(middleware);

			expect(orpc.match(/resolveSession\(/g)).toHaveLength(2);

			expect(orpc.includes('import { auth } from "@acme/auth"')).toBe(usesAuth);

			expect(orpc).toContain(
				`return await next({ context: { ${usesAuth ? "db, " : ""}session } });`,
			);

			expect(writeContent(plan, "packages/orpc/src/index.ts")).not.toContain(
				"createORPCContext",
			);

			for (const path of caller === undefined ? [route] : [route, caller]) {
				const content = writeContent(plan, path);
				expect(content, path).not.toContain("getSession");
				expect(content, path).not.toContain("createORPCContext");
				expect(content, path).not.toContain('from "@acme/auth"');
			}

			if (caller === undefined) return;

			expect(writeContent(plan, caller)).toMatch(
				caller.endsWith("client.ts")
					? /context: \(\) => \(\{ headers: getRequest\(\)\.headers \}\)/
					: config.web === "nextjs"
						? /createRouterClient\(appRouter, \{\s*context: async \(\) => \{/
						: /createRouterClient\(appRouter, \{\s*context: \{ headers: /,
			);
		},
	);
});

const renderedOrpcDirectories: Array<string> = [];

afterEach(async () => {
	vi.restoreAllMocks();
	await Promise.all(
		renderedOrpcDirectories
			.splice(0)
			.map((directory) => rm(directory, { recursive: true, force: true })),
	);
});

async function renderedOrpcPackage() {
	const plan = await plannedProject(supportedConfig);
	const directory = await mkdtemp(join(tmpdir(), "forge-orpc-"));
	const path = join(directory, "orpc.ts");
	const server = pathToFileURL(
		createRequire(import.meta.url).resolve("@orpc/server"),
	).href;

	renderedOrpcDirectories.push(directory);
	await writeFile(
		path,
		writeContent(plan, "packages/orpc/src/orpc.ts").replace(
			'from "@orpc/server"',
			`from ${JSON.stringify(server)}`,
		),
	);

	const rendered: {
		publicProcedure: ReturnType<typeof os.$context<{ headers: Headers }>>;
		reportServerError: (error: unknown, path: string) => void;
	} = await import(path);

	return rendered;
}

function failingRouter(
	publicProcedure: ReturnType<typeof os.$context<{ headers: Headers }>>,
	error: unknown,
) {
	return { health: publicProcedure.handler(() => Promise.reject(error)) };
}

async function postHealth(
	handler: RPCHandler<{ headers: Headers }>,
): Promise<Response> {
	const request = new Request("http://localhost/api/orpc/health", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ json: null }),
	});

	const { response } = await handler.handle(request, {
		prefix: "/api/orpc",
		context: { headers: request.headers },
	});

	if (response === undefined) throw new Error("Unmatched Request: health");
	return response;
}

describe("generated oRPC error reporting", () => {
	it.each([
		{
			name: "a shared error",
			error: new Error("Session store unreachable"),
			body: {
				defined: false,
				code: "INTERNAL_SERVER_ERROR",
				status: 500,
				message: "Internal server error",
			},
		},
		{
			name: "a shared 503",
			error: new ORPCError("SERVICE_UNAVAILABLE", { message: "Paused" }),
			body: {
				defined: false,
				code: "SERVICE_UNAVAILABLE",
				status: 503,
				message: "Paused",
			},
		},
	])("logs $name once per request, every request", async ({ error, body }) => {
		const logged = vi.spyOn(console, "error").mockImplementation(() => {});
		const { publicProcedure, reportServerError } = await renderedOrpcPackage();
		const router = failingRouter(publicProcedure, error);
		const handler = new RPCHandler(router, {
			interceptors: [
				onError((thrown, { request }) =>
					reportServerError(thrown, request.url.pathname),
				),
			],
		});

		for (const attempt of [1, 2]) {
			const response = await postHealth(handler);

			expect(response.status).toBe(body.status);
			expect(await response.json()).toEqual({ json: body });
			expect(logged).toHaveBeenCalledTimes(attempt);
			expect(logged).toHaveBeenLastCalledWith(
				"❌ oRPC failed on health:",
				error,
			);
		}

		const client = createRouterClient(router, {
			context: () => ({ headers: new Headers() }),
		});

		for (const attempt of [3, 4]) {
			await expect(client.health()).rejects.toMatchObject({
				code: body.code,
				cause: error,
			});

			expect(logged).toHaveBeenCalledTimes(attempt);
		}
	});

	it("leaves client errors unlogged", async () => {
		const logged = vi.spyOn(console, "error").mockImplementation(() => {});
		const { publicProcedure } = await renderedOrpcPackage();
		const handler = new RPCHandler(
			failingRouter(publicProcedure, new ORPCError("UNAUTHORIZED")),
		);

		expect((await postHealth(handler)).status).toBe(401);
		expect(logged).not.toHaveBeenCalled();
	});
});

describe("rpcProviderError", () => {
	it.each<ForgeConfig>([
		{ backend: "express", web: "nextjs" },
		{ backend: "fastify", web: "nextjs" },
		{ backend: "self", web: "nextjs" },
	])("accepts supported oRPC hosts with Next.js: %j", (config) => {
		expect(rpcProviderError(config, "orpc")).toBeUndefined();
	});

	it("requires an API host for a TanStack Router self host", () => {
		expect(
			rpcProviderError({ backend: "self", web: "tanstack-router" }, "orpc"),
		).toMatchObject({ reason: "api-host-required" });
	});

	it("accepts the supported pair", () => {
		expect(rpcProviderError(supportedConfig, "orpc")).toBeUndefined();
	});

	it.each<ForgeConfig>([
		{},
		supportedConfig,
		{ backend: "self", web: "tanstack-router" },
		{ backend: "express", web: "nextjs", mobile: "expo" },
	])("preserves tRPC host validation for %j", (config) => {
		expect(rpcProviderError(config, "trpc")).toEqual(
			apiHostError(config, rpcConsumer("trpc")),
		);
	});
});

describe("rpcProviderTemplate", () => {
	it.each(["trpc?: ElementType", "dataProviders.trpc"])(
		"requires exactly one %s anchor",
		(anchor) => {
			const template = "trpc?: ElementType; dataProviders.trpc";

			expect(() =>
				rpcProviderTemplate(template.replace(anchor, ""), "orpc"),
			).toThrow(`Template Anchor Not Unique: ${anchor}`);

			expect(() =>
				rpcProviderTemplate(`${template}; ${anchor}`, "orpc"),
			).toThrow(`Template Anchor Not Unique: ${anchor}`);
		},
	);

	it("leaves tRPC templates unchanged", () => {
		expect(rpcProviderTemplate("unaltered", "trpc")).toBe("unaltered");
	});
});
