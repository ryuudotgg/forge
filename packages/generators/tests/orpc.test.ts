import { GeneratorError } from "@ryuugg/core";
import { describe, expect, it } from "vitest";
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

const unsupportedOrpcPairs: ReadonlyArray<{
	name: string;
	config: ForgeConfig;
}> = [
	{ name: "Next.js self host", config: { backend: "self", web: "nextjs" } },
	{
		name: "React Router self host",
		config: { backend: "self", web: "react-router" },
	},
	{
		name: "TanStack Start self host",
		config: { backend: "self", web: "tanstack-start" },
	},
	{ name: "Next.js client", config: { web: "nextjs" } },
	{ name: "React Router client", config: { web: "react-router" } },
	{ name: "TanStack Start client", config: { web: "tanstack-start" } },
	{ name: "Express host", config: { backend: "express" } },
	{ name: "Fastify host", config: { backend: "fastify" } },
	{
		name: "Expo client",
		config: { mobile: "expo", platforms: ["web", "mobile"] },
	},
];

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

			expect(
				context.includes("opts.auth.api.getSession({ headers: opts.headers })"),
			).toBe(usesAuth);

			expect(context).toContain('throw new ORPCError("UNAUTHORIZED")');
			const router = writeContent(plan, "packages/orpc/src/router.ts");
			expect(router.includes("me: protectedProcedure.handler")).toBe(usesAuth);
			expect(router).toContain(
				'health: publicProcedure.handler(() => ({ status: "ok" as const }))',
			);

			const route = writeContent(plan, "apps/server/src/routes/orpc.ts");
			expect(route).toContain("SimpleCsrfProtectionHandlerPlugin");
			expect(route).toContain('prefix: "/api/orpc"');
			expect(route).toContain("c.newResponse(response.body, response)");
			expect(route.includes('import { auth } from "@acme/auth"')).toBe(
				usesAuth,
			);

			expect(route.includes("createORPCContext({ auth, headers:")).toBe(
				usesAuth,
			);

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
		expect(context).toContain("return { db, headers: opts.headers, session }");
		expect(context).toContain("const session = null;");
		expect(writeContent(plan, "packages/orpc/src/router.ts")).not.toContain(
			"me:",
		);
	});

	it.each(unsupportedOrpcPairs)(
		"rejects $name until supported",
		async ({ config }) => {
			const error = await plannedProject({
				...supportedConfig,
				...config,
			}).catch((cause: unknown) => cause);

			expect(error).toBeInstanceOf(GeneratorError);
			expect(error).toMatchObject({
				generatorId: "orpc",
				reason: "framework-not-supported-yet",
			});
		},
	);
});

describe("rpcProviderError", () => {
	it("names the unsupported host before the client", () => {
		expect(
			rpcProviderError({ backend: "express", web: "nextjs" }, "orpc"),
		).toMatchObject({
			reason: "framework-not-supported-yet",
			frameworkName: "Express",
		});
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
