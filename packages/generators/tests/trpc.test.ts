import type { Contribution } from "@ryuujs/core";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import type { ForgeConfig } from "../src";
import { trpc } from "../src";

function contributionsFor(config: ForgeConfig): ReadonlyArray<Contribution> {
	const result = trpc.contribute({ config });
	if (result instanceof Promise || Effect.isEffect(result))
		throw new Error("Synchronous Contributions Expected: trpc");
	return result;
}

function leafFile(
	contributions: ReadonlyArray<Contribution>,
	moduleKey: string,
	path: string,
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
			contribution.path === path,
	);
	if (found === undefined)
		throw new Error(`Missing Leaf File: ${moduleKey}/${path}`);

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

const baseConfig: ForgeConfig = { orm: "drizzle", rpc: "trpc", slug: "acme" };

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
			"app/api/trpc/[trpc]/route.ts",
		);
		expect(route).toContain('import { auth } from "@acme/auth";');
		expect(route).toContain("createTRPCContext({ auth, headers })");

		const server = leafFile(contributions, "web", "trpc/server.ts");
		expect(server).toContain('import { auth } from "@acme/auth";');
		expect(server).toContain("createTRPCContext({ auth, headers: heads })");

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
			"app/api/trpc/[trpc]/route.ts",
		);
		expect(route).not.toContain("@acme/auth");
		expect(route).toContain("createTRPCContext({ headers })");

		const server = leafFile(contributions, "web", "trpc/server.ts");
		expect(server).not.toContain("@acme/auth");
		expect(server).toContain("createTRPCContext({ headers: heads })");

		expect(trpcDependencyNames(contributions)).not.toContain("@acme/auth");
	});
});
