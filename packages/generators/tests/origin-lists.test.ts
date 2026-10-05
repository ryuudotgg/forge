import { randomUUID } from "node:crypto";
import { stripTypeScriptTypes } from "node:module";
import { Script } from "node:vm";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ForgeConfig } from "../src/config";
import { plannedProject } from "./planner-harness";

type Plan = Awaited<ReturnType<typeof plannedProject>>;

afterEach(() => vi.unstubAllEnvs());

function writeContent(plan: Plan, path: string): string {
	const write = plan.writes.find((entry) => entry.path === path);
	if (write === undefined) throw new Error(`Missing Write: ${path}`);
	return write.content;
}

const client = { name: "admin", framework: "nextjs", client: true } as const;

const withAuth: ForgeConfig = {
	authentication: "better-auth",
	authMethods: ["email-password", "passkey"],
	database: "sqlite",
	orm: "drizzle",
	slug: "acme",
};

const shapes: ReadonlyArray<{
	readonly name: string;
	readonly config: ForgeConfig;
	readonly owner: string;
	readonly consumers: ReadonlyArray<string>;
}> = [
	{
		name: "Better Auth on Hono",
		config: {
			...withAuth,
			backend: "hono",
			rpc: "trpc",
			web: "tanstack-router",
			webApps: [client],
		},
		owner: "packages/auth/env.ts",
		consumers: [
			"apps/server/env.ts",
			"apps/server/src/routes/auth.ts",
			"apps/server/src/routes/trpc.ts",
			"packages/auth/src/index.ts",
			"packages/auth/src/passkey.ts",
		],
	},
	{
		name: "Better Auth on Express with oRPC",
		config: {
			...withAuth,
			backend: "express",
			rpc: "orpc",
			web: "nextjs",
			webApps: [client],
		},
		owner: "packages/auth/env.ts",
		consumers: [
			"apps/server/env.ts",
			"apps/server/src/app.ts",
			"packages/auth/src/index.ts",
		],
	},
	{
		name: "Better Auth on a self hosted Next.js app",
		config: {
			...withAuth,
			backend: "self",
			rpc: "trpc",
			web: "nextjs",
			webApps: [client],
		},
		owner: "packages/auth/env.ts",
		consumers: [
			"apps/web/lib/api-cors.ts",
			"packages/auth/src/index.ts",
			"packages/auth/src/passkey.ts",
		],
	},
	{
		name: "Better Auth on a self hosted React Router app",
		config: {
			...withAuth,
			backend: "self",
			rpc: "trpc",
			web: "react-router",
			webApps: [client],
		},
		owner: "packages/auth/env.ts",
		consumers: ["apps/web/app/lib/api-cors.ts", "packages/auth/src/index.ts"],
	},
	{
		name: "Hono without auth",
		config: {
			backend: "hono",
			rpc: "trpc",
			slug: "acme",
			web: "nextjs",
			webApps: [client],
		},
		owner: "apps/server/env.ts",
		consumers: ["apps/server/src/routes/trpc.ts"],
	},
	{
		name: "Fastify without auth",
		config: {
			backend: "fastify",
			rpc: "trpc",
			slug: "acme",
			web: "nextjs",
			webApps: [client],
		},
		owner: "apps/server/env.ts",
		consumers: ["apps/server/src/app.ts"],
	},
	{
		name: "a self hosted Next.js app without auth",
		config: {
			backend: "self",
			rpc: "trpc",
			slug: "acme",
			web: "nextjs",
			webApps: [client],
		},
		owner: "apps/web/lib/api-cors.ts",
		consumers: [],
	},
	{
		name: "a self hosted TanStack Start app without auth",
		config: {
			backend: "self",
			rpc: "trpc",
			slug: "acme",
			web: "tanstack-start",
			webApps: [client],
		},
		owner: "apps/web/src/lib/api-cors.ts",
		consumers: [],
	},
];

describe("origin lists", () => {
	it.each(shapes)(
		"parses WEB_URLS in one place for $name",
		async ({ config, owner, consumers }) => {
			const plan = await plannedProject(config);
			const parsers = plan.writes
				.filter((write) => write.content.includes("function originList("))
				.map((write) => write.path);

			expect(parsers).toEqual([owner]);

			for (const path of consumers)
				expect(writeContent(plan, path), path).toContain("webOrigins");

			for (const write of plan.writes) {
				expect(write.content, write.path).not.toContain("...env.WEB_URLS");
				expect(write.content, write.path).not.toContain(
					"process.env.WEB_URLS?.split",
				);
			}

			const declaration = writeContent(plan, owner);
			expect(declaration).toContain("webOrigins = originList(");
			expect(declaration).not.toContain(".transform(");

			if (owner.endsWith("env.ts"))
				expect(declaration).toContain("WEB_URLS: z.string().optional(),");
		},
	);

	it("never defaults WEB_URLS to a development origin", async () => {
		for (const { config } of shapes) {
			const plan = await plannedProject(config);
			for (const path of [
				"apps/server/env.ts",
				"apps/web/proxy.ts",
				"apps/web/lib/api-cors.ts",
				"apps/web/app/lib/api-cors.ts",
				"apps/web/src/lib/api-cors.ts",
			]) {
				const write = plan.writes.find((entry) => entry.path === path);
				if (write === undefined) continue;

				expect(write.content, path).not.toContain("localhost:3002");

				if (path !== "apps/server/env.ts")
					expect(write.content, path).not.toContain("localhost");
			}
		}
	});

	it("keeps single app origins unchanged", async () => {
		const plan = await plannedProject({
			...withAuth,
			backend: "hono",
			rpc: "trpc",
			web: "nextjs",
		});

		expect(writeContent(plan, "packages/auth/src/index.ts")).toContain(
			"trustedOrigins: [env.WEB_URL],",
		);

		expect(writeContent(plan, "packages/auth/src/passkey.ts")).toContain(
			"origin: relyingParty.origin,",
		);

		expect(writeContent(plan, "apps/server/src/routes/trpc.ts")).toContain(
			"origin: env.WEB_URL,",
		);

		expect(
			plan.writes.some((write) => write.content.includes("originList")),
		).toBe(false);
	});

	it("feeds every Better Auth trust list from the same binding", async () => {
		const plan = await plannedProject({
			...withAuth,
			backend: "hono",
			rpc: "trpc",
			web: "tanstack-router",
			webApps: [client],
		});

		const server = writeContent(plan, "packages/auth/src/index.ts");
		const passkey = writeContent(plan, "packages/auth/src/passkey.ts");

		expect(server).toContain(
			'import { env, webOrigins } from "@acme/auth/env";',
		);

		expect(server).toContain("trustedOrigins: webOrigins,");
		expect(passkey).toContain('import { env, webOrigins } from "../env";');
		expect(passkey).toContain("origin: webOrigins,");
		expect(writeContent(plan, "apps/server/env.ts")).toContain(
			'export { webOrigins } from "@acme/auth/env";',
		);

		expect(writeContent(plan, "apps/server/src/routes/auth.ts")).toContain(
			'import { webOrigins } from "../../env.js";',
		);
	});

	it("delegates the Next.js proxy to the shared CORS helper", async () => {
		const plan = await plannedProject({
			backend: "self",
			rpc: "trpc",
			slug: "acme",
			web: "nextjs",
			webApps: [client],
		});

		const proxy = writeContent(plan, "apps/web/proxy.ts");
		expect(proxy).toContain(
			'import { preflight, withCors } from "./lib/api-cors";',
		);

		expect(proxy).not.toContain("Access-Control-Allow-Origin");
	});
});

function originListFrom(source: string) {
	const start = source.indexOf("function originList(");
	if (start === -1) throw new Error("Missing Origin Parser: generated env");

	return (sources: Readonly<Record<string, string | undefined>>): unknown => {
		const call = `originList(${JSON.stringify(sources)})`;
		const result: unknown = new Script(
			`${stripTypeScriptTypes(source.slice(start))}\nJSON.stringify(${call});`,
		).runInNewContext({ URL });

		if (typeof result !== "string")
			throw new Error("Invalid Origin List: generated parser");

		return JSON.parse(result);
	};
}

describe("generated origin parser", () => {
	it("normalizes, dedupes and validates origins", async () => {
		const plan = await plannedProject({
			backend: "hono",
			rpc: "trpc",
			slug: "acme",
			web: "nextjs",
			webApps: [client],
		});

		const originList = originListFrom(writeContent(plan, "apps/server/env.ts"));

		expect(originList({ WEB_URL: undefined, WEB_URLS: undefined })).toEqual([]);

		expect(originList({ WEB_URL: "https://a.test", WEB_URLS: "" })).toEqual([
			"https://a.test",
		]);

		expect(
			originList({
				WEB_URL: "https://a.test/",
				WEB_URLS: " https://b.test , ,",
			}),
		).toEqual(["https://a.test", "https://b.test"]);

		expect(
			originList({
				WEB_URL: "https://a.test",
				WEB_URLS: "https://a.test/,https://b.test",
			}),
		).toEqual(["https://a.test", "https://b.test"]);
	});

	it.each([
		["WEB_URLS", "localhost:3002"],
		["WEB_URLS", "admin.example.com"],
		["WEB_URLS", "null"],
		["WEB_URLS", "https://"],
		["WEB_URL", "admin.example.com"],
		["APP_ORIGIN", "ftp://example.com"],
	])("names %s when it holds %s", async (name, value) => {
		const plan = await plannedProject({
			backend: "hono",
			rpc: "trpc",
			slug: "acme",
			web: "nextjs",
			webApps: [client],
		});

		const originList = originListFrom(writeContent(plan, "apps/server/env.ts"));
		const sources = {
			[name]: value,
			WEB_URLS: name === "WEB_URLS" ? value : "https://b.test",
		};

		expect(() => originList(sources)).toThrow(
			`${name} holds ${value}, which is not an http or https URL.`,
		);
	});

	it("names the variable each generated owner passes", async () => {
		const standalone = await plannedProject({
			...withAuth,
			backend: "hono",
			rpc: "trpc",
			web: "nextjs",
			webApps: [client],
		});

		const selfHosted = await plannedProject({
			...withAuth,
			backend: "self",
			rpc: "trpc",
			web: "nextjs",
			webApps: [client],
		});

		const withoutAuth = await plannedProject({
			backend: "self",
			rpc: "trpc",
			slug: "acme",
			web: "tanstack-start",
			webApps: [client],
		});

		expect(writeContent(standalone, "packages/auth/env.ts")).toContain(
			"originList({\n  WEB_URL: env.WEB_URL,\n  WEB_URLS: env.WEB_URLS,\n});",
		);

		expect(writeContent(selfHosted, "packages/auth/env.ts")).toContain(
			"originList({\n  APP_ORIGIN: env.APP_ORIGIN,\n  WEB_URLS: env.WEB_URLS,\n});",
		);

		expect(writeContent(withoutAuth, "apps/web/src/lib/api-cors.ts")).toContain(
			"originList({\n  WEB_URLS: process.env.WEB_URLS,\n});",
		);
	});
});

async function importedHelper(source: string) {
	const exports: Record<string, unknown> = await import(
		`data:text/javascript,${encodeURIComponent(`${stripTypeScriptTypes(source)}\n// ${randomUUID()}`)}`
	);

	const { preflight, withCors } = exports;
	if (typeof preflight !== "function" || typeof withCors !== "function")
		throw new Error("Missing CORS Functions: generated helper");

	return {
		preflight: (request: Request): Response => {
			const response: unknown = preflight(request);
			if (!(response instanceof Response))
				throw new Error("Invalid CORS Response: preflight");

			return response;
		},
		withCors: async (request: Request, response: Response) => {
			const result: unknown = await withCors(request, response);
			if (!(result instanceof Response))
				throw new Error("Invalid CORS Response: route");

			return result;
		},
	};
}

function corsRequest(origin: string, method = "OPTIONS") {
	return new Request("http://localhost:5173/api/trpc/health", {
		method,
		headers: { Origin: origin, "Access-Control-Request-Method": "POST" },
	});
}

describe("generated self hosted CORS helper", () => {
	async function helperSource() {
		const plan = await plannedProject({
			backend: "self",
			rpc: "trpc",
			slug: "acme",
			web: "react-router",
			webApps: [client],
		});

		return writeContent(plan, "apps/web/app/lib/api-cors.ts");
	}

	it.each([undefined, ""])(
		"refuses a development origin when WEB_URLS is %j",
		async (value) => {
			vi.stubEnv("WEB_URLS", value);

			const helper = await importedHelper(await helperSource());
			const refused = helper.preflight(corsRequest("http://localhost:3002"));

			expect(refused.status).toBe(403);
			expect(refused.headers.get("Access-Control-Allow-Origin")).toBeNull();
			expect(refused.headers.get("Vary")).toBe("Origin");
		},
	);

	it("varies allowed and refused responses on Origin", async () => {
		vi.stubEnv("WEB_URLS", " http://localhost:5174/, , ");
		const helper = await importedHelper(await helperSource());

		const allowed = helper.preflight(corsRequest("http://localhost:5174"));
		expect(allowed.status).toBe(204);
		expect(allowed.headers.get("Access-Control-Allow-Origin")).toBe(
			"http://localhost:5174",
		);

		expect(allowed.headers.get("Access-Control-Max-Age")).toBe("600");
		expect(allowed.headers.get("Vary")).toBe("Origin");

		const refused = await helper.withCors(
			corsRequest("https://elsewhere.example", "GET"),
			new Response("ok", { headers: { Vary: "Accept" } }),
		);

		expect(refused.headers.get("Access-Control-Allow-Origin")).toBeNull();
		expect(refused.headers.get("Vary")).toBe("Accept, Origin");

		const merged = await helper.withCors(
			corsRequest("http://localhost:5174", "GET"),
			new Response("ok", { headers: { Vary: "Accept-Encoding, Origin" } }),
		);

		expect(merged.headers.get("Access-Control-Allow-Origin")).toBe(
			"http://localhost:5174",
		);

		expect(merged.headers.get("Vary")).toBe("Accept-Encoding, Origin");
	});
});
