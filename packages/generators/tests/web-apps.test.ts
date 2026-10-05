import { createHash, randomUUID } from "node:crypto";
import { stripTypeScriptTypes } from "node:module";
import { dirname, join } from "node:path";
import type { ProjectPlan } from "@ryuugg/core";
import { Schema } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	builtins,
	type ForgeConfig,
	reservedWebAppNames,
	webAppInstances,
	webFrameworks,
} from "../src";
import { plannedProject } from "./planner-harness";

afterEach(() => vi.unstubAllEnvs());

const appPackageSchema = Schema.fromJsonString(
	Schema.Struct({
		name: Schema.String,
		dependencies: Schema.Record(Schema.String, Schema.String),
		scripts: Schema.Struct({ dev: Schema.String }),
	}),
);

function contentAt(plan: ProjectPlan, path: string): string {
	const write = plan.writes.find((entry) => entry.path === path);
	if (write === undefined) throw new Error(`Missing Planned File: ${path}`);
	return write.content;
}

function stablePlan(plan: ProjectPlan): string {
	const moduleRoots = Object.entries(plan.manifest.modules).map(
		([id, module]) => {
			if (module.root === undefined)
				throw new Error(`Missing Module Root: ${id}`);

			return { id, root: module.root };
		},
	);

	let serialized = JSON.stringify({
		writes: plan.writes.map(({ path, content }) => ({ path, content })),
		manifest: { ...plan.manifest, config: {} },
		lockfile: plan.lockfile,
	});

	for (const { id, root } of moduleRoots)
		serialized = serialized.replaceAll(id, root);

	for (const write of plan.writes.filter((entry) =>
		entry.path.endsWith("/forge.json"),
	)) {
		let content = write.content;
		for (const { id, root } of moduleRoots)
			content = content.replaceAll(id, root);

		serialized = serialized.replaceAll(
			createHash("sha256").update(write.content).digest("hex"),
			createHash("sha256").update(content).digest("hex"),
		);
	}

	return serialized;
}

describe("webAppInstances", () => {
	it("has no instances without a primary web framework", () => {
		expect(webAppInstances({})).toEqual([]);
		expect(
			webAppInstances({
				webApps: [{ name: "admin", framework: "nextjs" }],
			}),
		).toEqual([]);
	});

	it("keeps the primary unmarked without secondary apps", () => {
		for (const webApps of [undefined, []]) {
			const instances = webAppInstances({ web: "nextjs", webApps });

			expect(instances).toEqual([
				{
					key: "web",
					root: "apps/web",
					packageName: "@my-app/web",
					framework: "nextjs",
					port: 3000,
					primary: true,
				},
			]);

			expect(instances[0]).not.toHaveProperty("role");
		}
	});

	it("allocates ordered instances without using the backend port", () => {
		for (const backend of [undefined, "hono"] as const) {
			const instances = webAppInstances({
				slug: "acme",
				web: "tanstack-router",
				backend,
				webApps: [
					{ name: "admin", framework: "tanstack-router" },
					{ name: "docs", framework: "tanstack-router" },
				],
			});

			expect(instances).toEqual([
				{
					key: "web",
					root: "apps/web",
					packageName: "@acme/web",
					framework: "tanstack-router",
					port: 3000,
					primary: true,
					role: "primary",
				},
				{
					key: "admin",
					root: "apps/admin",
					packageName: "@acme/admin",
					framework: "tanstack-router",
					port: 3002,
					primary: false,
				},
				{
					key: "docs",
					root: "apps/docs",
					packageName: "@acme/docs",
					framework: "tanstack-router",
					port: 3003,
					primary: false,
				},
			]);
		}
	});

	it("allocates React Router ports above 5173", () => {
		expect(
			webAppInstances({
				web: "react-router",
				webApps: [{ name: "admin", framework: "react-router" }],
			}).map((instance) => instance.port),
		).toEqual([5173, 5174]);
	});

	it("reserves every generated app and package name", () => {
		expect(reservedWebAppNames).toEqual([
			"web",
			"server",
			"mobile",
			"desktop",
			"worker",
			"auth",
			"db",
			"ui",
			"trpc",
			"orpc",
			"email",
			"shared",
			"tsconfig",
			"github",
		]);
	});
});

describe("secondary web app planning", () => {
	it.each(["nextjs", "tanstack-router"] as const)(
		"allows tRPC streaming headers on a single app Hono server beside %s",
		async (web) => {
			const plan = await plannedProject({
				slug: "acme",
				web,
				backend: "hono",
				rpc: "trpc",
			});

			expect(contentAt(plan, "apps/server/src/routes/trpc.ts")).toContain(
				'      "x-trpc-source",\n      "trpc-accept",\n',
			);
		},
	);

	it.each([
		{
			web: "react-router",
			rpcRoute: "app/routes/api.trpc.$.ts",
			authRoute: "app/routes/api.auth.$.ts",
			cors: "app/lib/api-cors.ts",
		},
		{
			web: "tanstack-start",
			rpcRoute: "src/routes/api/trpc/$.ts",
			authRoute: "src/routes/api/auth/$.ts",
			cors: "src/lib/api-cors.ts",
		},
	] as const)(
		"adds credentialed preflight to a self-hosted $web primary",
		async ({ web, rpcRoute, authRoute, cors }) => {
			const plan = await plannedProject({
				slug: "acme",
				web,
				backend: "self",
				rpc: "trpc",
				authentication: "better-auth",
				orm: "drizzle",
				database: "sqlite",
				webApps: [{ name: "admin", framework: "nextjs", client: true }],
			});

			expect(contentAt(plan, `apps/web/${cors}`)).toContain(
				'headers.set("Access-Control-Allow-Credentials", "true");',
			);

			expect(contentAt(plan, `apps/web/${cors}`)).toContain(
				"x-csrf-token, trpc-accept",
			);

			const rpcContent = contentAt(plan, `apps/web/${rpcRoute}`);
			expect(rpcContent).toContain(
				web === "react-router"
					? 'loader = (args: LoaderFunctionArgs) => args.request.method === "OPTIONS" ? preflight(args.request)'
					: "preflight(request)",
			);

			if (web === "react-router")
				expect(rpcContent).toContain(
					'action = (args: ActionFunctionArgs) => args.request.method === "OPTIONS" ? preflight(args.request)',
				);

			expect(rpcContent).toContain(
				web === "react-router" ? "withCors(args.request" : "withCors(request",
			);

			const authContent = contentAt(plan, `apps/web/${authRoute}`);
			expect(authContent).toContain("preflight(request)");

			if (web === "react-router")
				expect(authContent.match(/preflight\(request\)/g)).toHaveLength(2);

			expect(authContent).toContain("withCors(request");

			expect(contentAt(plan, "apps/admin/lib/auth-client.ts")).toContain(
				"NEXT_PUBLIC_SERVER_URL",
			);
		},
	);

	it.each(["react-router", "tanstack-start"] as const)(
		"wires secondary oRPC clients to a self-hosted %s primary",
		async (web) => {
			const plan = await plannedProject({
				slug: "acme",
				web,
				backend: "self",
				rpc: "orpc",
				webApps: [{ name: "admin", framework: "nextjs", client: true }],
			});

			const route = contentAt(
				plan,
				web === "react-router"
					? "apps/web/app/routes/api.orpc.$.ts"
					: "apps/web/src/routes/api/orpc/$.ts",
			);

			expect(route).toContain("preflight(");
			expect(route).toContain("withCors(");
			expect(route).toContain("SimpleCsrfProtectionHandlerPlugin");
			expect(contentAt(plan, "apps/web/vite.config.ts")).toContain(
				"server: { cors: false }",
			);

			const primary = contentAt(
				plan,
				`apps/web/${web === "react-router" ? "app" : "src"}/orpc/client.ts`,
			);

			expect(primary).toContain("window.location.origin");
			const secondary = contentAt(plan, "apps/admin/orpc/client.ts");
			expect(secondary).toContain("NEXT_PUBLIC_SERVER_URL");
			expect(secondary).not.toContain("window.location.origin");
			expect(contentAt(plan, "apps/admin/orpc/react.tsx")).toContain(
				"QueryClientProvider",
			);

			expect(contentAt(plan, "apps/admin/package.json")).toContain(
				'"@acme/orpc"',
			);
		},
	);

	it.each([
		{ rpc: "trpc", secondary: "react-router", root: "app/" },
		{ rpc: "orpc", secondary: "tanstack-start", root: "src/" },
	] as const)(
		"wires $secondary to a Next.js primary with $rpc",
		async ({ rpc, secondary, root }) => {
			const plan = await plannedProject({
				slug: "acme",
				web: "nextjs",
				backend: rpc === "orpc" ? "hono" : "self",
				rpc,
				authentication: "better-auth",
				orm: "drizzle",
				database: "sqlite",
				webApps: [{ name: "admin", framework: secondary, client: true }],
			});

			expect(
				contentAt(
					plan,
					`apps/admin/${root}${rpc}/${rpc === "trpc" ? "react.tsx" : "client.ts"}`,
				),
			).toContain("VITE_SERVER_URL");

			expect(contentAt(plan, `apps/admin/${root}lib/auth-client.ts`)).toContain(
				'import { env } from "../../env";',
			);

			expect(contentAt(plan, `apps/admin/${root}lib/auth-client.ts`)).toContain(
				"baseURL: env.VITE_SERVER_URL",
			);

			expect(
				contentAt(plan, `apps/admin/${root}lib/auth-client.ts`),
			).not.toContain("interface ImportMetaEnv");

			expect(contentAt(plan, `apps/admin/${root}providers.tsx`)).toContain(
				rpc === "trpc" ? "TRPCReactProvider" : "ORPCReactProvider",
			);

			expect(
				plan.writes.some((write) =>
					write.path.startsWith(`apps/admin/${root}routes/api/`),
				),
			).toBe(false);
		},
	);

	it.each(["trpc", "orpc"] as const)(
		"wires an opted-in Next.js client to a Hono %s host",
		async (rpc) => {
			const plan = await plannedProject({
				slug: "acme",
				web: "tanstack-router",
				backend: "hono",
				rpc,
				authentication: "better-auth",
				orm: "drizzle",
				database: "sqlite",
				webApps: [{ name: "admin", framework: "nextjs", client: true }],
			});

			expect(
				contentAt(
					plan,
					`apps/admin/${rpc}/${rpc === "trpc" ? "react.tsx" : "client.ts"}`,
				),
			).toContain("NEXT_PUBLIC_SERVER_URL");

			expect(contentAt(plan, "apps/admin/lib/auth-client.ts")).toContain(
				'import { env } from "../env";',
			);

			expect(contentAt(plan, "apps/admin/lib/auth-client.ts")).toContain(
				"baseURL: env.NEXT_PUBLIC_SERVER_URL",
			);

			expect(contentAt(plan, "apps/admin/app/providers.tsx")).toContain(
				rpc === "trpc" ? "TRPCReactProvider" : "ORPCReactProvider",
			);

			expect(contentAt(plan, "apps/server/env.ts")).toContain(
				'export { webOrigins } from "@acme/auth/env";',
			);

			expect(contentAt(plan, "packages/auth/env.ts")).toContain(
				"export const webOrigins = originList({\n  WEB_URL: env.WEB_URL,\n  WEB_URLS: env.WEB_URLS,\n});",
			);

			expect(contentAt(plan, "packages/auth/src/index.ts")).toContain(
				"trustedOrigins: webOrigins,",
			);

			expect(contentAt(plan, "apps/server/src/routes/auth.ts")).toContain(
				"origin: webOrigins,",
			);

			if (rpc === "trpc")
				expect(contentAt(plan, "apps/server/src/routes/trpc.ts")).toContain(
					'      "x-trpc-source",\n      "trpc-accept",\n',
				);
		},
	);

	it.each(["express", "fastify"] as const)(
		"allows tRPC streaming headers on %s with or without clients",
		async (backend) => {
			const config: ForgeConfig = {
				slug: "acme",
				web: "nextjs",
				backend,
				rpc: "trpc",
			};

			const indent = backend === "express" ? "    " : "  ";
			const streamingHeaders = [
				`${indent}allowedHeaders: [`,
				...[
					"Content-Type",
					"Authorization",
					"x-trpc-source",
					"trpc-accept",
				].map((header) => `${indent}  "${header}",`),
				`${indent}],`,
			].join("\n");

			for (const projectConfig of [
				config,
				{
					...config,
					webApps: [{ name: "admin", framework: "nextjs", client: true }],
				} satisfies ForgeConfig,
			]) {
				const plan = await plannedProject(projectConfig);
				expect(contentAt(plan, "apps/server/src/app.ts")).toContain(
					streamingHeaders,
				);
			}
		},
	);

	it.each(["express", "fastify"] as const)(
		"keeps tRPC streaming headers off an oRPC %s server with a client",
		async (backend) => {
			const plan = await plannedProject({
				slug: "acme",
				web: "nextjs",
				backend,
				rpc: "orpc",
				webApps: [{ name: "admin", framework: "nextjs", client: true }],
			});

			const app = contentAt(plan, "apps/server/src/app.ts");
			expect(app).toContain('"x-csrf-token"');
			expect(app).not.toContain("trpc-accept");
		},
	);

	it.each(["express", "fastify"] as const)(
		"keeps tRPC streaming headers off an auth only %s server",
		async (backend) => {
			const plan = await plannedProject({
				slug: "acme",
				web: "nextjs",
				backend,
				authentication: "better-auth",
				orm: "drizzle",
				database: "sqlite",
			});

			expect(contentAt(plan, "apps/server/src/app.ts")).not.toContain(
				"trpc-accept",
			);
		},
	);

	it("points a self-hosted secondary auth client at the primary origin", async () => {
		const plan = await plannedProject({
			slug: "acme",
			web: "nextjs",
			backend: "self",
			authentication: "better-auth",
			orm: "drizzle",
			database: "sqlite",
			webApps: [{ name: "admin", framework: "nextjs", client: true }],
		});

		expect(contentAt(plan, "apps/admin/env.ts")).toContain(
			'NEXT_PUBLIC_SERVER_URL: z.url().default("http://localhost:3000")',
		);

		expect(contentAt(plan, "apps/admin/lib/auth-client.ts")).toContain(
			"baseURL: env.NEXT_PUBLIC_SERVER_URL",
		);

		expect(contentAt(plan, "packages/auth/env.ts")).toContain(
			"export const webOrigins = originList({\n  APP_ORIGIN: env.APP_ORIGIN,\n  WEB_URLS: env.WEB_URLS,\n});",
		);

		expect(contentAt(plan, "packages/auth/src/index.ts")).toContain(
			"trustedOrigins: webOrigins,",
		);

		expect(contentAt(plan, "apps/web/lib/api-cors.ts")).toContain(
			'headers.set("Access-Control-Allow-Credentials", "true");',
		);

		expect(contentAt(plan, "apps/web/proxy.ts")).toContain(
			'if (request.method === "OPTIONS") return preflight(request);',
		);

		expect(contentAt(plan, "apps/web/lib/api-cors.ts")).toContain(
			"x-csrf-token, trpc-accept",
		);
	});

	it.each([
		{
			web: "nextjs",
			authentication: undefined,
			clients: ["nextjs"],
			lines: ['NEXT_PUBLIC_SERVER_URL="http://localhost:3000"'],
		},
		{
			web: "nextjs",
			authentication: "better-auth",
			clients: ["react-router"],
			lines: ['VITE_SERVER_URL="http://localhost:3000"'],
		},
		{
			web: "react-router",
			authentication: undefined,
			clients: ["nextjs", "tanstack-router", "tanstack-start"],
			lines: [
				'NEXT_PUBLIC_SERVER_URL="http://localhost:5173"',
				'VITE_SERVER_URL="http://localhost:5173"',
			],
		},
	] as const)(
		"lists the API URL $clients clients read once beside a self-hosted $web primary",
		async ({ web, authentication, clients, lines }) => {
			const plan = await plannedProject({
				slug: "acme",
				web,
				backend: "self",
				rpc: "trpc",
				...(authentication === undefined
					? {}
					: { authentication, orm: "drizzle", database: "sqlite" }),
				webApps: clients.map((framework, index) => ({
					name: `client${index}`,
					framework,
					client: true,
				})),
			});

			for (const path of [".env", ".env.example"]) {
				const content = contentAt(plan, path);
				for (const line of lines)
					expect(content.split("\n").filter((entry) => entry === line)).toEqual(
						[line],
					);

				expect(content.match(/SERVER_URL=/g)).toHaveLength(lines.length);
			}
		},
	);

	it.each(["hono", "self"] as const)(
		"keeps the server URL out of a non client secondary beside a client with backend %s",
		async (backend) => {
			const plan = await plannedProject({
				slug: "acme",
				web: "nextjs",
				backend,
				rpc: "trpc",
				webApps: [
					{ name: "admin", framework: "nextjs", client: true },
					{ name: "docs", framework: "nextjs" },
					{ name: "blog", framework: "tanstack-router" },
				],
			});

			expect(contentAt(plan, "apps/admin/env.ts")).toContain(
				`NEXT_PUBLIC_SERVER_URL: z.url().default("http://localhost:${backend === "hono" ? 3001 : 3000}")`,
			);

			for (const path of ["apps/docs/env.ts", "apps/blog/env.ts"])
				expect(contentAt(plan, path)).not.toContain("SERVER_URL");

			if (backend === "self")
				expect(contentAt(plan, "apps/web/env.ts")).not.toContain("SERVER_URL");
		},
	);

	it.each(["react-router", "tanstack-start"] as const)(
		"keeps the server URL out of a self-hosted %s primary with a client",
		async (web) => {
			const plan = await plannedProject({
				slug: "acme",
				web,
				backend: "self",
				rpc: "trpc",
				webApps: [
					{ name: "admin", framework: "tanstack-router", client: true },
				],
			});

			expect(contentAt(plan, "apps/web/env.ts")).not.toContain("SERVER_URL");
			expect(contentAt(plan, "apps/admin/env.ts")).toContain(
				`VITE_SERVER_URL: z.url().default("http://localhost:${web === "react-router" ? 5173 : 3000}")`,
			);
		},
	);

	it.each(webFrameworks.ids.filter((web) => web !== "nextjs"))(
		"guards process in every %s env module",
		async (web) => {
			const plan = await plannedProject({ slug: "acme", web });
			const env = contentAt(plan, "apps/web/env.ts");

			expect(env).toContain(
				'const processEnv: Record<string, string | undefined> =\n  typeof process === "undefined" ? {} : process.env;\n',
			);

			expect(env.match(/process\.env/g)).toHaveLength(1);
		},
	);

	it.each(["nextjs", "react-router", "tanstack-start"] as const)(
		"adds CORS to an implicit self-hosted %s primary",
		async (web) => {
			const plan = await plannedProject({
				slug: "acme",
				web,
				rpc: "trpc",
				authentication: "better-auth",
				orm: "drizzle",
				database: "sqlite",
				webApps: [{ name: "admin", framework: "nextjs", client: true }],
			});

			const corsPath =
				web === "nextjs"
					? "lib/api-cors.ts"
					: web === "react-router"
						? "app/lib/api-cors.ts"
						: "src/lib/api-cors.ts";

			expect(contentAt(plan, `apps/web/${corsPath}`)).toContain("trpc-accept");

			if (web === "react-router")
				expect(contentAt(plan, "apps/web/app/routes/api.auth.$.ts")).toContain(
					'if (request.method === "OPTIONS") return preflight(request);',
				);
		},
	);

	it("runs the generated CORS helper with tRPC preflight headers", async () => {
		vi.stubEnv("WEB_URLS", "http://localhost:5174");

		const plan = await plannedProject({
			slug: "acme",
			web: "react-router",
			backend: "self",
			rpc: "trpc",
			webApps: [{ name: "admin", framework: "nextjs", client: true }],
		});

		const source = contentAt(plan, "apps/web/app/lib/api-cors.ts");
		const exports: Record<string, unknown> = await import(
			`data:text/javascript,${encodeURIComponent(`${stripTypeScriptTypes(source)}\n// ${randomUUID()}`)}`
		);

		if (
			typeof exports.preflight !== "function" ||
			typeof exports.withCors !== "function"
		)
			throw new Error("Missing CORS Functions: generated helper");

		const request = new Request("http://localhost:5173/api/trpc", {
			method: "OPTIONS",
			headers: {
				Origin: "http://localhost:5174",
				"Access-Control-Request-Headers": "trpc-accept, content-type",
			},
		});

		const preflight: unknown = exports.preflight(request);
		if (!(preflight instanceof Response))
			throw new Error("Invalid CORS Response: preflight");

		expect(preflight.status).toBe(204);
		expect(preflight.headers.get("Access-Control-Allow-Headers")).toContain(
			"trpc-accept",
		);

		const result: unknown = await exports.withCors(
			request,
			new Response("ok", { headers: { Vary: "Accept-Encoding" } }),
		);

		if (!(result instanceof Response))
			throw new Error("Invalid CORS Response: route");

		expect(result.headers.get("Vary")).toBe("Accept-Encoding, Origin");
		expect(result.headers.get("Access-Control-Allow-Origin")).toBe(
			"http://localhost:5174",
		);

		const existing: unknown = await exports.withCors(
			request,
			new Response("ok", { headers: { Vary: "Accept-Encoding, Origin" } }),
		);

		if (!(existing instanceof Response))
			throw new Error("Invalid CORS Response: existing vary");

		expect(existing.headers.get("Vary")).toBe("Accept-Encoding, Origin");
	});

	it.each(
		webFrameworks.ids.flatMap((primary) =>
			webFrameworks.ids
				.filter((secondary) => secondary !== primary)
				.map((secondary) => ({ primary, secondary })),
		),
	)(
		"plans $primary with a $secondary secondary app",
		async ({ primary, secondary }) => {
			const plan = await plannedProject({
				name: "Acme",
				slug: "acme",
				web: primary,
				backend: "hono",
				rpc: "trpc",
				authentication: "better-auth",
				orm: "drizzle",
				database: "sqlite",
				style: "tailwind",
				linter: "biome",
				packageManager: "pnpm",
				webApps: [{ name: "admin", framework: secondary }],
			});

			const roots = Object.values(plan.manifest.modules).map(
				(module) => module.root,
			);

			const adminRoot = roots.find((root) => root?.endsWith("/admin"));
			const webRoot = roots.find((root) => root?.endsWith("/web"));
			const uiRoot = roots.find((root) => root?.endsWith("/ui"));
			const tsconfigPackage = plan.writes.find(
				(write) =>
					write.path.endsWith("/package.json") &&
					Schema.decodeSync(
						Schema.fromJsonString(Schema.Struct({ name: Schema.String })),
					)(write.content).name === "@acme/tsconfig",
			);

			if (
				adminRoot === undefined ||
				webRoot === undefined ||
				uiRoot === undefined ||
				tsconfigPackage === undefined
			)
				throw new Error("Missing Planned Module: mixed web apps");

			const forgeJsonSchema = Schema.fromJsonString(
				Schema.Struct({
					framework: Schema.String,
					template: Schema.Struct({ id: Schema.String }),
				}),
			);

			const componentsSchema = Schema.fromJsonString(
				Schema.Struct({ rsc: Schema.Boolean }),
			);

			const turboSchema = Schema.fromJsonString(
				Schema.Struct({
					tasks: Schema.Struct({
						build: Schema.Struct({ outputs: Schema.Array(Schema.String) }),
					}),
				}),
			);

			for (const { root, framework } of [
				{ root: adminRoot, framework: secondary },
				{ root: webRoot, framework: primary },
			]) {
				expect(
					Schema.decodeSync(forgeJsonSchema)(
						contentAt(plan, join(root, "forge.json")),
					),
				).toMatchObject({
					framework,
					template: { id: `${framework}/base` },
				});

				const components = Schema.decodeSync(componentsSchema)(
					contentAt(plan, join(root, "components.json")),
				);

				expect(components.rsc).toBe(framework === "nextjs");

				const definition = builtins.frameworks.find(
					(entry) => entry.id === framework,
				);

				if (definition === undefined)
					throw new Error(`Missing Framework: ${framework}`);

				expect(
					Schema.decodeSync(Schema.fromJsonString(Schema.Unknown))(
						contentAt(
							plan,
							join(
								dirname(tsconfigPackage.path),
								`${definition.tsconfigPreset.name}.json`,
							),
						),
					),
				).toEqual(definition.tsconfigPreset.content);

				expect(
					Schema.decodeSync(turboSchema)(contentAt(plan, "turbo.json")).tasks
						.build.outputs,
				).toEqual(expect.arrayContaining([...definition.buildOutputs]));
			}

			const uiComponents = Schema.decodeSync(componentsSchema)(
				contentAt(plan, join(uiRoot, "components.json")),
			);

			expect(uiComponents.rsc).toBe(true);

			const admin = Schema.decodeSync(appPackageSchema)(
				contentAt(plan, join(adminRoot, "package.json")),
			);

			for (const name of ["@acme/trpc", "@acme/auth", "@acme/db"])
				expect(admin.dependencies).not.toHaveProperty(name);

			const ignoreLines = contentAt(plan, ".gitignore").split("\n");
			expect(ignoreLines.filter((line) => line === ".tanstack/")).toHaveLength(
				primary.startsWith("tanstack-") || secondary.startsWith("tanstack-")
					? 1
					: 0,
			);
		},
	);

	it.each([
		...webFrameworks.ids.map((web) => ({ web, backend: "hono" as const })),
		...(["nextjs", "react-router", "tanstack-start"] as const).map((web) => ({
			web,
			backend: "self" as const,
		})),
	])(
		"keeps $web secondary apps free of API wiring with backend $backend",
		async ({ web, backend }) => {
			const config: ForgeConfig = {
				name: "Acme",
				slug: "acme",
				web,
				backend,
				rpc: "trpc",
				authentication: "better-auth",
				orm: "drizzle",
				database: "sqlite",
				style: "tailwind",
				linter: "biome",
				packageManager: "pnpm",
				webApps: [{ name: "admin", framework: web }],
			};

			const plan = await plannedProject(config);
			const admin = Schema.decodeSync(appPackageSchema)(
				contentAt(plan, "apps/admin/package.json"),
			);

			const primary = Schema.decodeSync(appPackageSchema)(
				contentAt(plan, "apps/web/package.json"),
			);

			expect(admin.name).toBe("@acme/admin");
			expect(admin.scripts.dev).toContain(
				`--port ${web === "react-router" ? 5174 : 3002}`,
			);

			expect(admin.dependencies).toHaveProperty("@acme/ui", "workspace:*");

			for (const name of ["@acme/trpc", "@acme/auth", "@acme/db"])
				expect(admin.dependencies).not.toHaveProperty(name);

			expect(primary.dependencies).toHaveProperty("@acme/trpc");
			expect(contentAt(plan, "apps/web/forge.json")).toContain(
				'"role": "primary"',
			);

			expect(contentAt(plan, "apps/admin/forge.json")).not.toContain('"role"');
			expect(
				plan.writes
					.map((write) => write.path)
					.filter(
						(path) =>
							path.startsWith("apps/admin/") && /trpc|auth|api/.test(path),
					),
			).toEqual([]);

			expect(
				plan.writes.some(
					(write) =>
						write.path.startsWith("apps/web/") && write.path.includes("trpc"),
				),
			).toBe(true);

			expect(contentAt(plan, "apps/admin/env.ts")).not.toContain("SERVER_URL");
			const sourceRoot =
				web === "nextjs" ? "app" : web === "react-router" ? "app" : "src";

			expect(
				contentAt(plan, `apps/admin/${sourceRoot}/providers.tsx`),
			).not.toContain("TRPC");

			expect(contentAt(plan, "apps/admin/forge.json")).not.toMatch(
				/"(?:api|auth|trpc)":/,
			);

			if (web === "nextjs") {
				const nextConfig = contentAt(plan, "apps/admin/next.config.ts");
				expect(nextConfig).toContain('transpilePackages: ["@acme/ui"]');
			}

			if (web === "react-router")
				expect(contentAt(plan, "apps/admin/app/routes.ts")).not.toContain(
					"api/",
				);
		},
	);

	it.each(webFrameworks.ids)(
		"treats an empty secondary list identically for %s",
		async (web) => {
			const config: ForgeConfig = {
				slug: "acme",
				web,
				backend: "hono",
				rpc: "trpc",
			};

			const original = await plannedProject(config);
			const empty = await plannedProject({ ...config, webApps: [] });

			expect(stablePlan(empty)).toBe(stablePlan(original));
			const primary = Schema.decodeSync(appPackageSchema)(
				contentAt(original, "apps/web/package.json"),
			);

			const command =
				web === "nextjs"
					? "next dev"
					: web === "react-router"
						? "react-router dev"
						: "vite dev --port 3000";

			expect(primary.scripts.dev).toBe(`pnpm with-env ${command}`);
			expect(contentAt(original, "apps/web/forge.json")).not.toContain(
				'"role"',
			);
		},
	);
});
