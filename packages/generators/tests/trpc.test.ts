import type { Contribution, SlotPath } from "@ryuujs/core";
import { slotPath } from "@ryuujs/core";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import type { ForgeConfig } from "../src";
import { trpc } from "../src";
import { nextjsFramework } from "../src/frameworks/nextjs";

function contributionsFor(config: ForgeConfig): ReadonlyArray<Contribution> {
	const result = trpc.contribute({ config, frameworks: [nextjsFramework] });
	if (result instanceof Promise || Effect.isEffect(result))
		throw new Error("Synchronous Contributions Expected: trpc");
	return result;
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
			contribution.target._tag === "EnsuredModuleTarget" &&
			contribution.target.moduleKey === moduleKey &&
			(typeof path === "string"
				? contribution.path === path
				: typeof contribution.path !== "string" &&
					contribution.path.moduleKey === path.moduleKey &&
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
