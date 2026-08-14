import type { AdapterModule, Contribution, SlotPath } from "@ryuujs/core";
import { slotPath } from "@ryuujs/core";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import type { ForgeConfig } from "../src";
import { builtins, trpc } from "../src";
import { nextjsFramework } from "../src/frameworks/nextjs";
import { reactRouterFramework } from "../src/frameworks/react-router";
import { tanstackStartFramework } from "../src/frameworks/tanstack-start";

function contributionsFor(config: ForgeConfig): ReadonlyArray<Contribution> {
	const framework =
		config.web === "tanstack-start"
			? tanstackStartFramework
			: config.web === "react-router"
				? reactRouterFramework
				: nextjsFramework;

	const core = trpc.contribute({
		commandVersions: {},
		config,
		frameworks: [framework],
	});

	if (core instanceof Promise || Effect.isEffect(core))
		throw new Error("Synchronous Contributions Expected: trpc");

	const slots =
		config.web === "tanstack-start"
			? { trpc: "src/routes/api/trpc/$.ts" }
			: config.web === "react-router"
				? { trpc: "app/routes/api.trpc.$.ts" }
				: { trpc: "app/api/trpc/[trpc]/route.ts" };

	const module: AdapterModule = {
		config: {
			id: "abcde",
			type: "app",
			framework: framework.id,
			template: { id: `${framework.id}/base`, version: 1 },
			slots,
		},
		id: "abcde",
		root: "apps/web",
	};

	const adapter = builtins.adapters.find(
		(entry) => entry.addon === "trpc" && entry.framework === framework.id,
	);

	if (adapter === undefined)
		throw new Error(`Missing Adapter: trpc:${framework.id}`);

	const adapted = adapter.contribute({
		config,
		framework,
		module,
		slots,
	});

	if (adapted instanceof Promise || Effect.isEffect(adapted))
		throw new Error("Synchronous Adapter Contributions Expected: trpc");

	return [...core, ...adapted];
}

function leafFile(
	contributions: ReadonlyArray<Contribution>,
	moduleKey: string,
	path: string | SlotPath,
) {
	const found = contributions.find(
		(
			contribution,
		): contribution is Extract<
			Contribution,
			{ _tag: "LeafTextFileContribution" }
		> =>
			contribution._tag === "LeafTextFileContribution" &&
			((contribution.target._tag === "EnsuredModuleTarget" &&
				contribution.target.moduleKey === moduleKey) ||
				(contribution.target._tag === "ResolvedModuleTarget" &&
					moduleKey === "web")) &&
			(typeof path === "string"
				? contribution.path === path
				: typeof contribution.path !== "string" &&
					contribution.path.slot === path.slot),
	);

	if (found === undefined)
		throw new Error(
			`Missing Leaf File: ${moduleKey}/${typeof path === "string" ? path : path.slot}`,
		);

	return found.content;
}

function trpcDependencyNames(contributions: ReadonlyArray<Contribution>) {
	const found = contributions.find(
		(
			contribution,
		): contribution is Extract<
			Contribution,
			{ _tag: "ManagedDependenciesSurfaceContribution" }
		> =>
			contribution._tag === "ManagedDependenciesSurfaceContribution" &&
			contribution.target._tag === "EnsuredModuleTarget" &&
			contribution.target.moduleKey === "trpc" &&
			contribution.surface === "packageJson",
	);

	if (found === undefined) throw new Error("Missing Dependencies: trpc");

	return found.dependencies.map((dependency) => dependency.name);
}

const baseConfig: ForgeConfig = {
	orm: "drizzle",
	rpc: "trpc",
	slug: "acme",
	web: "nextjs",
};

function expectedContent(lines: ReadonlyArray<string>) {
	return `${lines.join("\n")}\n`;
}

const routeWithAuth = expectedContent([
	'import { appRouter, createTRPCContext } from "@acme/trpc";',
	'import { auth } from "@acme/auth";',
	'import { fetchRequestHandler } from "@trpc/server/adapters/fetch";',
	'import type { NextRequest } from "next/server";',
	"",
	"function createContext(req: NextRequest) {",
	"  const headers = new Headers(req.headers);",
	'  headers.set("x-trpc-source", "route");',
	"  return createTRPCContext({ auth, headers });",
	"}",
	"",
	"function handler(req: NextRequest) {",
	"  return fetchRequestHandler({",
	"    req,",
	"    router: appRouter,",
	'    endpoint: "/api/trpc",',
	"    createContext: () => createContext(req),",
	"    onError:",
	'      process.env.NODE_ENV === "development"',
	"        ? ({ path, error }) => {",
	"            console.error(",
	'              `❌ tRPC failed on \u0024{path ?? "<no-path>"}: \u0024{error.message}`,',
	"            );",
	"          }",
	"        : undefined,",
	"  });",
	"}",
	"",
	"export { handler as GET, handler as POST };",
]);

const routeWithoutAuth = expectedContent([
	'import { appRouter, createTRPCContext } from "@acme/trpc";',
	'import { fetchRequestHandler } from "@trpc/server/adapters/fetch";',
	'import type { NextRequest } from "next/server";',
	"",
	"function createContext(req: NextRequest) {",
	"  const headers = new Headers(req.headers);",
	'  headers.set("x-trpc-source", "route");',
	"  return createTRPCContext({ headers });",
	"}",
	"",
	"function handler(req: NextRequest) {",
	"  return fetchRequestHandler({",
	"    req,",
	"    router: appRouter,",
	'    endpoint: "/api/trpc",',
	"    createContext: () => createContext(req),",
	"    onError:",
	'      process.env.NODE_ENV === "development"',
	"        ? ({ path, error }) => {",
	"            console.error(",
	'              `❌ tRPC failed on \u0024{path ?? "<no-path>"}: \u0024{error.message}`,',
	"            );",
	"          }",
	"        : undefined,",
	"  });",
	"}",
	"",
	"export { handler as GET, handler as POST };",
]);

const serverWithAuth = expectedContent([
	'import "server-only";',
	"",
	'import type { AppRouter } from "@acme/trpc";',
	'import { createCaller, createTRPCContext } from "@acme/trpc";',
	'import { auth } from "@acme/auth";',
	'import { createHydrationHelpers } from "@trpc/react-query/rsc";',
	'import { headers } from "next/headers";',
	'import { cache } from "react";',
	"",
	'import { createQueryClient } from "./query-client";',
	"",
	"const createContext = cache(async () => {",
	"  const heads = new Headers(await headers());",
	'  heads.set("x-trpc-source", "rsc");',
	"",
	"  return createTRPCContext({ auth, headers: heads });",
	"});",
	"",
	"const getQueryClient = cache(createQueryClient);",
	"const caller = createCaller(createContext);",
	"",
	"export const { trpc: api, HydrateClient } = createHydrationHelpers<AppRouter>(",
	"  caller,",
	"  getQueryClient,",
	");",
]);

const serverWithoutAuth = expectedContent([
	'import "server-only";',
	"",
	'import type { AppRouter } from "@acme/trpc";',
	'import { createCaller, createTRPCContext } from "@acme/trpc";',
	'import { createHydrationHelpers } from "@trpc/react-query/rsc";',
	'import { headers } from "next/headers";',
	'import { cache } from "react";',
	"",
	'import { createQueryClient } from "./query-client";',
	"",
	"const createContext = cache(async () => {",
	"  const heads = new Headers(await headers());",
	'  heads.set("x-trpc-source", "rsc");',
	"",
	"  return createTRPCContext({ headers: heads });",
	"});",
	"",
	"const getQueryClient = cache(createQueryClient);",
	"const caller = createCaller(createContext);",
	"",
	"export const { trpc: api, HydrateClient } = createHydrationHelpers<AppRouter>(",
	"  caller,",
	"  getQueryClient,",
	");",
]);

const tanstackRouteWithAuth = expectedContent([
	"// Loads the server-route type augmentation for createFileRoute.",
	'import "@tanstack/react-start";',
	"",
	'import { appRouter, createTRPCContext } from "@acme/trpc";',
	'import { auth } from "@acme/auth";',
	'import { createFileRoute } from "@tanstack/react-router";',
	'import { fetchRequestHandler } from "@trpc/server/adapters/fetch";',
	"",
	"function createContext(request: Request) {",
	"  const headers = new Headers(request.headers);",
	'  headers.set("x-trpc-source", "route");',
	"  return createTRPCContext({ auth, headers });",
	"}",
	"",
	"function handler({ request }: { readonly request: Request }) {",
	"  return fetchRequestHandler({",
	"    req: request,",
	"    router: appRouter,",
	'    endpoint: "/api/trpc",',
	"    createContext: () => createContext(request),",
	"    onError:",
	'      process.env.NODE_ENV === "development"',
	"        ? ({ path, error }) => {",
	"            console.error(",
	'              `❌ tRPC failed on \u0024{path ?? "<no-path>"}: \u0024{error.message}`,',
	"            );",
	"          }",
	"        : undefined,",
	"  });",
	"}",
	"",
	'export const Route = createFileRoute("/api/trpc/$")({',
	"  server: {",
	"    handlers: {",
	"      GET: handler,",
	"      POST: handler,",
	"    },",
	"  },",
	"});",
]);

const tanstackRouteWithoutAuth = expectedContent([
	"// Loads the server-route type augmentation for createFileRoute.",
	'import "@tanstack/react-start";',
	"",
	'import { appRouter, createTRPCContext } from "@acme/trpc";',
	'import { createFileRoute } from "@tanstack/react-router";',
	'import { fetchRequestHandler } from "@trpc/server/adapters/fetch";',
	"",
	"function createContext(request: Request) {",
	"  const headers = new Headers(request.headers);",
	'  headers.set("x-trpc-source", "route");',
	"  return createTRPCContext({ headers });",
	"}",
	"",
	"function handler({ request }: { readonly request: Request }) {",
	"  return fetchRequestHandler({",
	"    req: request,",
	"    router: appRouter,",
	'    endpoint: "/api/trpc",',
	"    createContext: () => createContext(request),",
	"    onError:",
	'      process.env.NODE_ENV === "development"',
	"        ? ({ path, error }) => {",
	"            console.error(",
	'              `❌ tRPC failed on \u0024{path ?? "<no-path>"}: \u0024{error.message}`,',
	"            );",
	"          }",
	"        : undefined,",
	"  });",
	"}",
	"",
	'export const Route = createFileRoute("/api/trpc/$")({',
	"  server: {",
	"    handlers: {",
	"      GET: handler,",
	"      POST: handler,",
	"    },",
	"  },",
	"});",
]);

const sharedServerWithAuth = expectedContent([
	'import { createCaller, createTRPCContext } from "@acme/trpc";',
	'import { auth } from "@acme/auth";',
	"",
	"export async function createServerCaller(request: Request) {",
	"  const headers = new Headers(request.headers);",
	'  headers.set("x-trpc-source", "server");',
	"",
	"  const context = await createTRPCContext({ auth, headers });",
	"  return createCaller(context);",
	"}",
]);

const sharedServerWithoutAuth = expectedContent([
	'import { createCaller, createTRPCContext } from "@acme/trpc";',
	"",
	"export async function createServerCaller(request: Request) {",
	"  const headers = new Headers(request.headers);",
	'  headers.set("x-trpc-source", "server");',
	"",
	"  const context = await createTRPCContext({ headers });",
	"  return createCaller(context);",
	"}",
]);

describe("trpc auth context", () => {
	it("resolves and passes the full better-auth session when auth is active", () => {
		const contributions = contributionsFor({
			...baseConfig,
			authentication: "better-auth",
		});

		const trpcFile = leafFile(contributions, "trpc", "src/trpc.ts");
		expect(trpcFile).toContain('import type { Auth } from "@acme/auth";');
		expect(trpcFile).toContain(
			'Awaited<ReturnType<Auth["api"]["getSession"]>>',
		);
		expect(trpcFile).toContain("opts.auth.api.getSession");
		expect(trpcFile).not.toContain("session: null");

		const route = leafFile(
			contributions,
			"web",
			slotPath({ _tag: "EnsuredModuleTarget", moduleKey: "web" }, "trpc"),
		);
		expect(route).toContain('import { auth } from "@acme/auth";');
		expect(route).toContain("createTRPCContext({ auth, headers })");
		expect(route).toBe(routeWithAuth);

		const server = leafFile(contributions, "web", "trpc/server.ts");
		expect(server).toContain('import { auth } from "@acme/auth";');
		expect(server).toContain("createTRPCContext({ auth, headers: heads })");
		expect(server).toBe(serverWithAuth);

		expect(trpcDependencyNames(contributions)).toContain("@acme/auth");
	});

	it("keeps auth out of the context when auth is inactive", () => {
		const contributions = contributionsFor(baseConfig);

		const trpcFile = leafFile(contributions, "trpc", "src/trpc.ts");
		expect(trpcFile).toContain("const session = null;");
		expect(trpcFile).not.toContain("@acme/auth");
		expect(trpcFile).not.toContain("getSession");

		const route = leafFile(
			contributions,
			"web",
			slotPath({ _tag: "EnsuredModuleTarget", moduleKey: "web" }, "trpc"),
		);
		expect(route).not.toContain("@acme/auth");
		expect(route).toContain("createTRPCContext({ headers })");
		expect(route).toBe(routeWithoutAuth);

		const server = leafFile(contributions, "web", "trpc/server.ts");
		expect(server).not.toContain("@acme/auth");
		expect(server).toContain("createTRPCContext({ headers: heads })");
		expect(server).toBe(serverWithoutAuth);

		expect(trpcDependencyNames(contributions)).not.toContain("@acme/auth");
	});
});

describe("trpc tanstack-start variant", () => {
	const tanstackConfig: ForgeConfig = {
		orm: "drizzle",
		rpc: "trpc",
		slug: "acme",
		web: "tanstack-start",
	};

	it("renders the fetch route and server caller with auth", () => {
		const contributions = contributionsFor({
			...tanstackConfig,
			authentication: "better-auth",
		});
		const route = leafFile(
			contributions,
			"web",
			slotPath({ _tag: "EnsuredModuleTarget", moduleKey: "web" }, "trpc"),
		);
		const server = leafFile(contributions, "web", "src/trpc/server.ts");

		expect(route).toBe(tanstackRouteWithAuth);
		expect(server).toBe(sharedServerWithAuth);
		expect(route).not.toContain("next/");
		expect(server).not.toContain("next/");
		expect(server).not.toContain("server-only");
	});

	it("removes both auth markers exactly when auth is inactive", () => {
		const contributions = contributionsFor(tanstackConfig);
		const route = leafFile(
			contributions,
			"web",
			slotPath({ _tag: "EnsuredModuleTarget", moduleKey: "web" }, "trpc"),
		);
		const server = leafFile(contributions, "web", "src/trpc/server.ts");

		expect(route).toBe(tanstackRouteWithoutAuth);
		expect(server).toBe(sharedServerWithoutAuth);
		expect(route).not.toMatch(/__[A-Z_]+__/);
		expect(server).not.toMatch(/__[A-Z_]+__/);
	});

	it("writes tRPC support files beneath src/trpc", () => {
		const contributions = contributionsFor(tanstackConfig);
		const queryClient = leafFile(
			contributions,
			"web",
			"src/trpc/query-client.ts",
		);
		const provider = leafFile(contributions, "web", "src/trpc/react.tsx");

		expect(queryClient).toContain("export function createQueryClient");
		expect(provider).toContain("import.meta.env.DEV");
		expect(provider).not.toContain('"use client"');
		expect(provider).not.toContain("process.env.NODE_ENV");
	});

	it("leaves API host selection to resolution and target predicates", () => {
		expect(
			trpc.dependencies.some((dependency) => dependency.type === "template"),
		).toBe(false);
		expect(trpc.dependencies).toContainEqual({
			id: "typescript",
			type: "addon",
		});
	});
});

describe("trpc react-router variant", () => {
	const reactRouterConfig: ForgeConfig = {
		orm: "drizzle",
		rpc: "trpc",
		slug: "acme",
		web: "react-router",
	};

	it("renders fetch loader and action handlers with auth", () => {
		const contributions = contributionsFor({
			...reactRouterConfig,
			authentication: "better-auth",
		});
		const route = leafFile(
			contributions,
			"web",
			slotPath({ _tag: "EnsuredModuleTarget", moduleKey: "web" }, "trpc"),
		);
		const server = leafFile(contributions, "web", "app/trpc/server.ts");

		expect(route).toContain('import { auth } from "@acme/auth";');
		expect(route).toContain(
			"function handler({ request }: LoaderFunctionArgs | ActionFunctionArgs)",
		);
		expect(route).toContain(
			"export const loader = (args: LoaderFunctionArgs) => handler(args);",
		);
		expect(route).toContain(
			"export const action = (args: ActionFunctionArgs) => handler(args);",
		);
		expect(route).not.toContain("createFileRoute");
		expect(server).toBe(sharedServerWithAuth);
	});

	it("removes auth markers and writes support files beneath app/trpc", () => {
		const contributions = contributionsFor(reactRouterConfig);
		const route = leafFile(
			contributions,
			"web",
			slotPath({ _tag: "EnsuredModuleTarget", moduleKey: "web" }, "trpc"),
		);
		const server = leafFile(contributions, "web", "app/trpc/server.ts");
		const queryClient = leafFile(
			contributions,
			"web",
			"app/trpc/query-client.ts",
		);
		const provider = leafFile(contributions, "web", "app/trpc/react.tsx");

		expect(route).toContain("createTRPCContext({ headers })");
		expect(route).not.toContain("@acme/auth");
		expect(route).not.toMatch(/__[A-Z_]+__/);
		expect(server).toBe(sharedServerWithoutAuth);
		expect(queryClient).toContain("export function createQueryClient");
		expect(provider).toContain("import.meta.env.DEV");
		expect(provider).not.toContain('"use client"');
	});
});
