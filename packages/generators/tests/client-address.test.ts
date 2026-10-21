import { createRequire, stripTypeScriptTypes } from "node:module";
import { Script } from "node:vm";
import { describe, expect, it } from "vitest";
import { renderBetterAuthTemplate } from "../src/auth/better-auth/shared";
import type { ForgeConfig } from "../src/config";
import { plannedProject } from "./planner-harness";

const config: ForgeConfig = {
	authentication: "better-auth",
	authMethods: ["email-password"],
	database: "sqlite",
	orm: "drizzle",
	packageManager: "pnpm",
	slug: "acme",
	web: "nextjs",
};

const hosts: ReadonlyArray<{
	backend: ForgeConfig["backend"];
	web: ForgeConfig["web"];
	route: string;
	helper: string | undefined;
	socket: string | undefined;
}> = [
	{
		backend: "hono",
		web: "nextjs",
		route: "apps/server/src/routes/auth.ts",
		helper: "withClientAddress",
		socket: "getConnInfo(c).remote.address",
	},
	{
		backend: "express",
		web: "nextjs",
		route: "apps/server/src/routes/auth.ts",
		helper: "forwardedFor",
		socket: "req.socket.remoteAddress",
	},
	{
		backend: "fastify",
		web: "nextjs",
		route: "apps/server/src/routes/auth.ts",
		helper: "withClientAddress",
		socket: "request.socket.remoteAddress",
	},
	{
		backend: "self",
		web: "tanstack-start",
		route: "apps/web/src/routes/api/auth/$.ts",
		helper: "withClientAddress",
		socket: "getRequestIP()",
	},
	{
		backend: "self",
		web: "nextjs",
		route: "apps/web/app/api/auth/[...all]/route.ts",
		helper: undefined,
		socket: undefined,
	},
	{
		backend: "self",
		web: "react-router",
		route: "apps/web/app/routes/api.auth.$.ts",
		helper: undefined,
		socket: undefined,
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

function clientAddressResult(
	proxies: string | undefined,
	expression: string,
	bindings: Record<string, unknown> = {},
	clientIpHeader?: string,
): unknown {
	const source = renderBetterAuthTemplate(
		config,
		"packages/auth/src/client-address.ts",
	)
		.replace('import { env } from "@acme/auth/env";', "")
		.replaceAll("export ", "");

	return new Script(
		`${stripTypeScriptTypes(source)}\n${expression};`,
	).runInNewContext({
		env: {
			AUTH_CLIENT_IP_HEADER: clientIpHeader,
			AUTH_TRUSTED_PROXIES: proxies,
		},
		Headers,
		Request,
		...bindings,
	});
}

const betterAuthRequire = createRequire(import.meta.resolve("better-auth"));
const zod: unknown = betterAuthRequire("zod");
function authEnvResult(expression: string): unknown {
	const source = renderBetterAuthTemplate(config, "packages/auth/env.ts")
		.replace('import { env as dbEnv } from "@acme/db/env";', "")
		.replace('import { createEnv } from "@t3-oss/env-core";', "")
		.replace('import { z } from "zod";', "")
		.replaceAll("export ", "");

	return new Script(
		`${stripTypeScriptTypes(source)}\n${expression};`,
	).runInNewContext({
		createEnv: (definition: unknown) => definition,
		dbEnv: {},
		process: { env: {} },
		URL,
		z: zod,
	});
}

describe("generated client addresses", () => {
	for (const orm of ["drizzle", "prisma"] satisfies ReadonlyArray<
		ForgeConfig["orm"]
	>)
		it.each(hosts)(
			`wires ${orm} client addresses for $backend with $web`,
			async ({ backend, web, route, helper, socket }) => {
				const plan = await plannedProject({ ...config, backend, orm, web });
				const env = writeContent(plan, "packages/auth/env.ts");
				const auth = writeContent(plan, "packages/auth/src/index.ts");
				const handler = writeContent(plan, route);

				for (const name of ["AUTH_TRUSTED_PROXIES", "AUTH_CLIENT_IP_HEADER"]) {
					expect(env).toContain(`${name}: z`);
					expect(env).toContain(`${name}: process.env.${name}`);
					expect(writeContent(plan, ".env")).toContain(`${name}="" #`);
					expect(writeContent(plan, ".env.example")).toContain(`${name}="" #`);
				}

				expect(auth).toContain("ipAddressHeaders: [clientIpHeader],");
				expect(auth).toContain("trustedProxies,");
				expect(auth).toContain(
					'import { clientIpHeader, trustedProxies } from "@acme/auth/client-address";',
				);

				expect(writeContent(plan, "packages/auth/package.json")).toContain(
					'"./client-address": "./src/client-address.ts"',
				);

				expect(
					writeContent(plan, "packages/auth/src/client-address.ts"),
				).toContain("new Request(request.url, init)");

				if (helper !== undefined && socket !== undefined) {
					expect(handler).toContain(helper);
					expect(handler).toContain(socket);
				} else expect(handler).not.toContain("client-address");

				if (web === "tanstack-start" && backend === "self") {
					expect(handler).toContain("  return auth.handler(request);");
					expect(writeContent(plan, "apps/web/package.json")).toContain(
						'"@tanstack/react-start"',
					);
				}
			},
		);

	it.each([
		{
			proxies: undefined,
			inbound: "203.0.113.1",
			socket: undefined,
			expected: undefined,
		},
		{
			proxies: "127.0.0.1/32",
			inbound: "203.0.113.1",
			socket: undefined,
			expected: undefined,
		},
		{
			proxies: undefined,
			inbound: "203.0.113.1",
			socket: "127.0.0.1",
			expected: "127.0.0.1",
		},
		{
			proxies: " , ",
			inbound: "203.0.113.1",
			socket: "127.0.0.1",
			expected: "127.0.0.1",
		},
		{
			proxies: "127.0.0.1/32",
			inbound: "203.0.113.1, 203.0.113.2",
			socket: "127.0.0.1",
			expected: "203.0.113.1, 203.0.113.2, 127.0.0.1",
		},
		{
			proxies: "127.0.0.1/32",
			inbound: null,
			socket: "127.0.0.1",
			expected: "127.0.0.1",
		},
		{
			proxies: "127.0.0.1/32",
			inbound: "",
			socket: "127.0.0.1",
			expected: "127.0.0.1",
		},
	])(
		"resolves forwarding with $proxies, $inbound and $socket",
		({ proxies, inbound, socket, expected }) => {
			expect(
				clientAddressResult(proxies, "forwardedFor(inbound, socket)", {
					inbound,
					socket,
				}),
			).toBe(expected);
		},
	);

	it.each([
		{ inbound: "203.0.113.42", expected: "203.0.113.42" },
		{ inbound: null, expected: undefined },
	])(
		"leaves forwarding untouched with a platform header for $inbound",
		({ inbound, expected }) => {
			expect(
				clientAddressResult(
					undefined,
					"forwardedFor(inbound, socket)",
					{ inbound, socket: "10.0.0.1" },
					"x-forwarded-for",
				),
			).toBe(expected);
		},
	);

	it.each([
		{ header: undefined, expected: "x-forwarded-for" },
		{ header: " x-real-ip ", expected: "x-real-ip" },
	])("reads the $header client IP header", ({ header, expected }) => {
		expect(clientAddressResult(undefined, "clientIpHeader", {}, header)).toBe(
			expected,
		);
	});

	it("parses raw proxy strings even when env validation is skipped", () => {
		expect(
			clientAddressResult(" 127.0.0.1/32, , ::1 ,", "trustedProxies"),
		).toEqual(["127.0.0.1/32", "::1"]);
	});

	it.each([undefined, "127.0.0.1/32"])(
		"copies a streaming POST with proxies %s",
		async (proxies) => {
			const original = new Request("http://localhost/api/auth/sign-in/email", {
				method: "POST",
				headers: {
					"content-type": "application/json",
					"x-forwarded-for": "203.0.113.1",
				},
				body: '{"email":"missing@example.com"}',
			});

			const result = clientAddressResult(
				proxies,
				'withClientAddress(original, "127.0.0.1")',
				{ original },
			);

			expect(result).toBeInstanceOf(Request);

			if (!(result instanceof Request))
				throw new Error("Invalid Client Request: expected Request");

			expect(result).not.toBe(original);
			expect(result.url).toBe(original.url);
			expect(result.method).toBe("POST");
			expect(result.headers.get("content-type")).toBe("application/json");
			expect(result.headers.get("x-forwarded-for")).toBe(
				proxies ? "203.0.113.1, 127.0.0.1" : "127.0.0.1",
			);

			expect(original.headers.get("x-forwarded-for")).toBe("203.0.113.1");
			expect(await result.text()).toBe('{"email":"missing@example.com"}');
		},
	);

	it("removes forwarding without a socket and preserves cancellation", () => {
		const controller = new AbortController();
		const original = new Request("http://localhost/api/auth/session", {
			headers: { "x-forwarded-for": "203.0.113.1" },
			signal: controller.signal,
		});

		const result = clientAddressResult(
			"127.0.0.1/32",
			"withClientAddress(original, undefined)",
			{ original },
		);

		if (!(result instanceof Request))
			throw new Error("Invalid Client Request: expected Request");

		expect(result.headers.has("x-forwarded-for")).toBe(false);
		expect(result.body).toBeNull();

		controller.abort();

		expect(result.signal.aborted).toBe(true);
	});

	it("rebuilds a server request that is not a native Request", async () => {
		const inbound = {
			url: "http://localhost/api/auth/sign-in/email",
			method: "POST",
			headers: new Headers({ "x-forwarded-for": "203.0.113.1" }),
			body: new Request("http://localhost", { method: "POST", body: "payload" })
				.body,
			signal: new AbortController().signal,
		};

		const result = clientAddressResult(
			undefined,
			'withClientAddress(inbound, "127.0.0.1")',
			{ inbound },
		);

		if (!(result instanceof Request))
			throw new Error("Invalid Client Request: expected Request");

		expect(result.url).toBe(inbound.url);
		expect(result.headers.get("x-forwarded-for")).toBe("127.0.0.1");
		expect(await result.text()).toBe("payload");
	});
});

describe("trusted proxy validation", () => {
	it.each([
		"",
		" , ",
		"127.0.0.1",
		"127.0.0.1/0",
		"127.0.0.1/32",
		"::1",
		"::/0",
		"2001:db8::/128",
		"127.0.0.1/32, ::1, 2001:db8::/64",
	])("accepts %s without transforming the string", (value) => {
		expect(
			authEnvResult(
				`env.server.AUTH_TRUSTED_PROXIES.parse(${JSON.stringify(value)})`,
			),
		).toBe(value);
	});

	it.each([
		"localhost",
		"999.0.0.1",
		"127.0.0.1/33",
		"::1/129",
		"127.0.0.1/-1",
		"::1/+1",
		"::1/1.5",
		"::1/1e2",
		"::1/",
		"::1/64/1",
		"::ffff:127.0.0.1/128",
		"::FFFF:7f00:1/128",
		"0:0:0:0:0:ffff:7f00:1",
		"0:0::ffff:7f00:1",
		"2001:db8::192.0.2.1",
	])("rejects %s and names the entry", (value) => {
		expect(
			authEnvResult(
				`env.server.AUTH_TRUSTED_PROXIES.safeParse(${JSON.stringify(value)}).error.issues[0].message`,
			),
		).toContain(value);
	});

	it("names every invalid entry", () => {
		expect(
			authEnvResult(
				'env.server.AUTH_TRUSTED_PROXIES.safeParse("127.0.0.1, localhost, ::1/129").error.issues[0].message',
			),
		).toBe("Invalid trusted proxies: localhost, ::1/129");
	});

	it.each(["x-real-ip", " X-Real-IP ", "!#$%&'*+.^_`|~0-9A-Za-z-"])(
		"accepts and trims header token %s",
		(value) => {
			expect(
				authEnvResult(
					`env.server.AUTH_CLIENT_IP_HEADER.parse(${JSON.stringify(value)})`,
				),
			).toBe(value.trim());
		},
	);

	it.each([
		"",
		" ",
		"x real ip",
		"x-real-ip:",
		"x-real-ip\r\nforged",
		"cliënt-ip",
	])("rejects header token %s", (value) => {
		expect(
			authEnvResult(
				`env.server.AUTH_CLIENT_IP_HEADER.safeParse(${JSON.stringify(value)}).success`,
			),
		).toBe(false);
	});
});
