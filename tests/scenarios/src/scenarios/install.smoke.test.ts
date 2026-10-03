import { spawn } from "node:child_process";
import { createHmac, randomUUID } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { join } from "node:path";
import { createContext, Script } from "node:vm";
import { build } from "vite";
import { describe, expect, it } from "vitest";
import { expectEmailAuth } from "../utils/email-auth";
import {
	createProject,
	expectInstallAndTypecheck,
	expectInstallBuildAndTypecheck,
	type ForgeCommandResult,
	forgeEnvironment,
	pathExists,
	readJson,
	runCommand,
	type ScenarioProject,
	withScenarioWorkspace,
} from "../utils/harness";
import { expectPasskeyCeremony } from "../utils/passkey";

const postgresProviderCells = [
	{ provider: "planetscale", transaction: "supported" },
	{ provider: "neon", transaction: "unsupported" },
	{ provider: "nile", transaction: "supported" },
	{ provider: "supabase", transaction: "supported" },
	{ provider: "prisma-postgres", transaction: "supported" },
] as const satisfies ReadonlyArray<{
	readonly provider: string;
	readonly transaction: "supported" | "unsupported";
}>;

const transactionProbeSource = `import { db } from "@acme/db/client";
import { sql } from "drizzle-orm";
import { integer, pgTable, text } from "drizzle-orm/pg-core";

const probe = pgTable("forge_smoke", {
  id: integer().primaryKey(),
  label: text().notNull(),
});

const rows = await db.transaction(async (tx) => {
  await tx.execute(
    sql\`create temporary table forge_smoke (id integer primary key, label text not null) on commit drop\`,
  );

  await tx.insert(probe).values({ id: 1, label: "forge" });
  return tx.select().from(probe);
});

if (rows[0]?.label !== "forge")
  throw new Error(\`Transaction Probe Mismatch: \${JSON.stringify(rows)}\`);

process.exit(0);
`;

// Generated schema files use extensionless imports, which Node type stripping cannot resolve.
const typeScriptResolveHookSource = `import { registerHooks } from "node:module";
import { extname } from "node:path";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (!specifier.startsWith(".") || extname(specifier) !== "")
      return nextResolve(specifier, context);

    for (const candidate of [\`\${specifier}.ts\`, \`\${specifier}/index.ts\`]) {
      try {
        return nextResolve(candidate, context);
      } catch {}
    }

    return nextResolve(specifier, context);
  },
});
`;

function smokeDatabaseUrl() {
	const url = process.env.FORGE_SMOKE_DATABASE_URL;
	if (url === undefined)
		throw new Error("Missing Smoke Database: FORGE_SMOKE_DATABASE_URL");

	return url;
}

async function runTransactionProbe(
	workspace: ScenarioProject,
	url: string,
): Promise<ForgeCommandResult> {
	const hookPath = join(workspace.workspaceRoot, "ts-resolve.mjs");
	await writeFile(hookPath, typeScriptResolveHookSource);

	return await runCommand(
		"node",
		["--import", hookPath, "src/transaction-probe.ts"],
		{
			cwd: join(workspace.projectRoot, "packages/db"),
			env: {
				...forgeEnvironment(workspace.workspaceRoot),
				DATABASE_URL: url,
				DATABASE_DIRECT_URL: url,
			},
		},
	);
}

async function readGeneratedEnv(projectRoot: string) {
	const content = await readFile(join(projectRoot, ".env"), "utf-8");
	const env: NodeJS.ProcessEnv = {};
	for (const line of content.split("\n")) {
		const match = /^([A-Z_]+)="([^"]*)"\s*(?:#.*)?$/.exec(line);
		const name = match?.[1];
		const value = match?.[2];
		if (name !== undefined && value !== undefined) env[name] = value;
	}

	return env;
}

const authPluginConfig = {
	authMethods: ["email-password", "google", "passkey"],
	authPlugins: ["two-factor", "username", "admin", "organization"],
};

function smokeMysqlUrl() {
	const url = process.env.FORGE_SMOKE_MYSQL_URL;
	if (url === undefined)
		throw new Error("Missing Smoke Database: FORGE_SMOKE_MYSQL_URL");

	return url;
}

function smokeDatabaseOn(serverUrl: string, name: string) {
	const url = new URL(serverUrl);
	url.pathname = `/${name}`;
	return url.toString();
}

const createDatabaseScripts = {
	postgresql: (name: string) =>
		[
			'import pg from "pg";',
			`const client = new pg.Client({ connectionString: ${JSON.stringify(smokeDatabaseUrl())} });`,
			"await client.connect();",
			`await client.query(${JSON.stringify(`DROP DATABASE IF EXISTS "${name}"`)});`,
			`await client.query(${JSON.stringify(`CREATE DATABASE "${name}"`)});`,
			"await client.end();",
		].join("\n"),
	mysql: (name: string) =>
		[
			'import mysql from "mysql2/promise";',
			`const connection = await mysql.createConnection(${JSON.stringify(smokeMysqlUrl())});`,
			`await connection.query(${JSON.stringify(`DROP DATABASE IF EXISTS \`${name}\``)});`,
			`await connection.query(${JSON.stringify(`CREATE DATABASE \`${name}\``)});`,
			"await connection.end();",
		].join("\n"),
};

async function createSmokeDatabase(
	projectRoot: string,
	dialect: keyof typeof createDatabaseScripts,
	name: string,
) {
	const result = await runCommand(
		"node",
		["--input-type=module", "-e", createDatabaseScripts[dialect](name)],
		{ cwd: join(projectRoot, "packages/db") },
	);

	expect(
		result.exitCode,
		`creating database ${name} failed with code ${result.exitCode}\n${result.stdout}\n${result.stderr}`,
	).toBe(0);
}

async function expectSchemaPush(projectRoot: string, env?: NodeJS.ProcessEnv) {
	const push = await runCommand("pnpm", ["db:push"], {
		cwd: join(projectRoot, "apps/web"),
		env,
	});

	expect(
		push.exitCode,
		`pnpm db:push failed with code ${push.exitCode}\n${push.stdout}\n${push.stderr}`,
	).toBe(0);
}

async function expectPasskeyInstallAndTypecheck(workspace: ScenarioProject) {
	await writeFile(
		join(workspace.projectRoot, "packages/auth/src/passkey-probe.ts"),
		[
			'import type { PasskeyOptions } from "@better-auth/passkey";',
			'import { authClient } from "./client";',
			"",
			"export const signIn = authClient.signIn.passkey;",
			"export const register = authClient.passkey.addPasskey;",
			"export const enableTwoFactor = authClient.twoFactor.enable;",
			"export const createOrganization = authClient.organization.create;",
			"export const inviteMember = authClient.organization.inviteMember;",
			"export const options = {",
			"  registration: { extensions: () => ({ credProps: true, prf: {} }) },",
			"  authentication: { extensions: () => ({ credProps: true, prf: {} }) },",
			"} satisfies PasskeyOptions;",
			"",
		].join("\n"),
	);

	await expectInstallAndTypecheck(workspace, "pnpm");
}

function postgresDatabaseEnv(name: string): NodeJS.ProcessEnv {
	const url = smokeDatabaseOn(smokeDatabaseUrl(), name);
	return { DATABASE_URL: url, DATABASE_DIRECT_URL: url };
}

function mysqlDatabaseEnv(name: string): NodeJS.ProcessEnv {
	return { DATABASE_URL: smokeDatabaseOn(smokeMysqlUrl(), name) };
}

async function withGeneratedServer(
	projectRoot: string,
	generatedEnv: NodeJS.ProcessEnv,
	serverOrigin: string,
	exercise: (output: () => string) => Promise<void>,
	host: "server" | "nextjs" = "server",
) {
	const ambientEnv = { ...process.env };
	delete ambientEnv.CI;

	const args =
		host === "nextjs"
			? ["node_modules/next/dist/bin/next", "start", "--port", "3000"]
			: ["dist/index.js"];

	const server = spawn("node", args, {
		cwd: join(projectRoot, host === "nextjs" ? "apps/web" : "apps/server"),
		env: { ...ambientEnv, ...generatedEnv },
	});

	let output = "";
	const capture = (chunk: Buffer) => {
		output += chunk.toString();
	};

	server.stdout.on("data", capture);
	server.stderr.on("data", capture);
	const exited = new Promise<void>((resolveExit) => {
		server.once("exit", () => resolveExit());
	});

	try {
		let ready = false;
		for (let attempt = 0; attempt < 50; attempt += 1) {
			try {
				const response = await fetch(`${serverOrigin}/`);
				if (response.ok) {
					ready = true;
					break;
				}
			} catch {}

			await new Promise((resolveWait) => setTimeout(resolveWait, 100));
		}

		expect(ready, output).toBe(true);

		await exercise(() => output);
	} finally {
		if (server.exitCode === null) server.kill("SIGTERM");
		await exited;
	}
}

async function expectCredentialedGeneratedServer(
	projectRoot: string,
	options?: {
		readonly clientOrigin?: string;
		readonly emailAuth?: boolean;
		readonly host?: "server" | "nextjs";
		readonly passkey?: boolean;
		readonly polar?: boolean;
		readonly rpc?: "trpc" | "orpc";
		readonly username?: string;
		readonly webOrigin?: string;
	},
) {
	const rpc = options?.rpc ?? "trpc";
	const generatedEnv = await readGeneratedEnv(projectRoot);
	const origin = options?.clientOrigin ?? generatedEnv.WEB_URL;
	const serverOrigin = generatedEnv.APP_ORIGIN;
	const credentials = options?.host === "nextjs" ? "include" : undefined;

	if (origin === undefined || serverOrigin === undefined)
		throw new Error(`Missing Generated Origins: ${projectRoot}`);

	if (options?.host === "nextjs") {
		expect(serverOrigin).toBe("http://localhost:3000");
		expect(generatedEnv.WEB_URLS?.split(",")).toContain(origin);
	} else {
		expect(generatedEnv.WEB_URL).toBe(
			options?.webOrigin ?? "http://localhost:3000",
		);

		expect(serverOrigin).toBe("http://localhost:3001");
	}

	if (options?.polar) {
		expect(generatedEnv.POLAR_ACCESS_TOKEN).toBe("");
		expect(generatedEnv.POLAR_WEBHOOK_SECRET).toBe("");
		expect(generatedEnv.POLAR_SERVER).toBe("sandbox");
	}

	await expectSchemaPush(projectRoot);

	await withGeneratedServer(
		projectRoot,
		generatedEnv,
		serverOrigin,
		async (output) => {
			if (rpc === "trpc") {
				const preflight = await fetch(`${serverOrigin}/api/trpc/health`, {
					credentials,
					method: "OPTIONS",
					headers: {
						Origin: origin,
						"Access-Control-Request-Headers": options?.clientOrigin
							? "x-trpc-source,trpc-accept"
							: "x-trpc-source",
						"Access-Control-Request-Method": "GET",
					},
				});

				expect(preflight.status).toBe(204);
				expect(preflight.headers.get("access-control-allow-origin")).toBe(
					origin,
				);

				expect(preflight.headers.get("access-control-allow-credentials")).toBe(
					"true",
				);

				expect(preflight.headers.get("access-control-allow-headers")).toContain(
					"x-trpc-source",
				);

				if (options?.clientOrigin)
					expect(
						preflight.headers.get("access-control-allow-headers"),
					).toContain("trpc-accept");

				const actual = await fetch(
					`${serverOrigin}/api/trpc/health?input=%7B%7D`,
					{
						credentials,
						headers: {
							Origin: origin,
							"x-trpc-source": "smoke",
							...(options?.host === "nextjs"
								? { "trpc-accept": "application/json" }
								: {}),
						},
					},
				);

				expect(actual.status).toBe(200);
				expect(actual.headers.get("access-control-allow-origin")).toBe(origin);
				expect(actual.headers.get("access-control-allow-credentials")).toBe(
					"true",
				);

				if (options?.host === "nextjs")
					expect(await actual.json()).toMatchObject({
						result: { data: { json: { status: "ok" } } },
					});
			}

			const email = "hono-smoke@example.com";
			const signup = await fetch(`${serverOrigin}/api/auth/sign-up/email`, {
				credentials,
				body: JSON.stringify({
					email,
					name: "Hono Smoke",
					password: "forge-smoke-password",
					...(options?.username ? { username: options.username } : {}),
				}),
				headers: { "Content-Type": "application/json", Origin: origin },
				method: "POST",
			});

			const signupBody = await signup.text();
			expect(signup.status, `${signupBody}\n${output()}`).toBe(200);
			expect(signup.headers.get("access-control-allow-origin")).toBe(origin);
			expect(signup.headers.get("access-control-allow-credentials")).toBe(
				"true",
			);

			const setCookie = signup.headers.get("set-cookie");
			expect(setCookie).toBeTruthy();

			if (setCookie === null)
				throw new Error("Missing Session Cookie: Better Auth sign-up");

			const cookie = setCookie.split(";", 1)[0];
			if (cookie === undefined)
				throw new Error("Missing Cookie Value: Better Auth sign-up");

			if (options?.passkey)
				await expectPasskeyCeremony(serverOrigin, origin, cookie, output);

			if (options?.emailAuth)
				await expectEmailAuth(serverOrigin, origin, output);

			if (options?.polar) {
				const checkout = await fetch(`${serverOrigin}/api/auth/checkout`, {
					body: JSON.stringify({ products: ["forge-smoke"] }),
					headers: {
						Cookie: cookie,
						Origin: origin,
						"Content-Type": "application/json",
					},
					method: "POST",
				});

				expect(checkout.status, `${await checkout.text()}\n${output()}`).toBe(
					503,
				);

				const customerState = await fetch(
					`${serverOrigin}/api/auth/customer/state`,
					{ headers: { Cookie: cookie, Origin: origin } },
				);

				expect(
					customerState.status,
					`${await customerState.text()}\n${output()}`,
				).toBe(503);

				const webhook = await fetch(`${serverOrigin}/api/auth/polar/webhooks`, {
					body: JSON.stringify({
						type: "forge.smoke",
						data: { message: "original" },
					}),
					headers: { "Content-Type": "application/json" },
					method: "POST",
				});

				expect(webhook.status, `${await webhook.text()}\n${output()}`).toBe(
					503,
				);
			}

			const authSession = await fetch(`${serverOrigin}/api/auth/get-session`, {
				credentials,
				headers: { Cookie: cookie, Origin: origin },
			});

			expect(authSession.status).toBe(200);
			expect(authSession.headers.get("access-control-allow-origin")).toBe(
				origin,
			);

			expect(authSession.headers.get("access-control-allow-credentials")).toBe(
				"true",
			);

			const username = options?.username;
			const session: unknown = await authSession.json();
			expect(session).toMatchObject({
				user:
					username === undefined
						? { email }
						: { email, role: "user", username },
			});

			if (rpc === "orpc") {
				if (
					typeof session !== "object" ||
					session === null ||
					!("user" in session) ||
					typeof session.user !== "object" ||
					session.user === null ||
					!("id" in session.user) ||
					typeof session.user.id !== "string"
				)
					throw new Error("Missing Session User: Better Auth get-session");

				await expectOrpcSession(serverOrigin, origin, cookie, session.user.id);
				await expectGeneratedOrpcClient(
					projectRoot,
					generatedEnv,
					cookie,
					session.user.id,
				);
			}

			if (username === undefined) return;

			const usernameSignIn = await fetch(
				`${serverOrigin}/api/auth/sign-in/username`,
				{
					body: JSON.stringify({ password: "forge-smoke-password", username }),
					headers: { "Content-Type": "application/json", Origin: origin },
					method: "POST",
				},
			);

			const usernameSignInBody = await usernameSignIn.text();
			expect(usernameSignIn.status, `${usernameSignInBody}\n${output()}`).toBe(
				200,
			);
		},
		options?.host,
	);

	if (!options?.polar) return;

	const secret = "forge-smoke-webhook-secret";
	await withGeneratedServer(
		projectRoot,
		{ ...generatedEnv, POLAR_WEBHOOK_SECRET: secret },
		serverOrigin,
		async (output) => {
			const body = JSON.stringify(
				{ type: "forge.smoke", data: { message: "original" } },
				null,
				2,
			);

			const checkout = await fetch(`${serverOrigin}/api/auth/checkout`, {
				body: JSON.stringify({ products: ["forge-smoke"] }),
				headers: { "Content-Type": "application/json" },
				method: "POST",
			});

			expect(checkout.status, `${await checkout.text()}\n${output()}`).toBe(
				503,
			);

			const webhookId = randomUUID();
			const timestamp = Math.floor(Date.now() / 1000).toString();
			const signature = createHmac("sha256", Buffer.from(secret, "utf8"))
				.update(`${webhookId}.${timestamp}.${body}`)
				.digest("base64");

			const headers = {
				"Content-Type": "application/json",
				"webhook-id": webhookId,
				"webhook-timestamp": timestamp,
				"webhook-signature": `v1,${signature}`,
			};

			const webhook = await fetch(`${serverOrigin}/api/auth/polar/webhooks`, {
				body,
				headers,
				method: "POST",
			});

			expect(webhook.status, `${await webhook.text()}\n${output()}`).toBe(200);

			const tampered = await fetch(`${serverOrigin}/api/auth/polar/webhooks`, {
				body: body.replace("original", "tampered"),
				headers,
				method: "POST",
			});

			expect(tampered.status, `${await tampered.text()}\n${output()}`).toBe(
				403,
			);
		},
	);

	await withGeneratedServer(
		projectRoot,
		{ ...generatedEnv, POLAR_ACCESS_TOKEN: "forge-smoke-token" },
		serverOrigin,
		async (output) => {
			const checkout = await fetch(`${serverOrigin}/api/auth/checkout`, {
				body: JSON.stringify({ products: ["forge-smoke"] }),
				headers: { "Content-Type": "application/json" },
				method: "POST",
			});

			expect(checkout.status, `${await checkout.text()}\n${output()}`).toBe(
				401,
			);
		},
	);
}

async function expectOrpcSession(
	serverOrigin: string,
	origin: string,
	cookie: string,
	userId: string,
) {
	const preflight = await fetch(`${serverOrigin}/api/orpc/me`, {
		method: "OPTIONS",
		headers: {
			Origin: origin,
			"Access-Control-Request-Headers": "content-type,x-csrf-token",
			"Access-Control-Request-Method": "POST",
		},
	});

	expect(preflight.status).toBe(204);
	expect(preflight.headers.get("access-control-allow-origin")).toBe(origin);
	expect(preflight.headers.get("access-control-allow-credentials")).toBe(
		"true",
	);

	expect(preflight.headers.get("access-control-allow-headers")).toContain(
		"x-csrf-token",
	);

	const headers = {
		Origin: origin,
		"Content-Type": "application/json",
		"x-csrf-token": "orpc",
	};

	const authenticated = await fetch(`${serverOrigin}/api/orpc/me`, {
		method: "POST",
		headers: { ...headers, Cookie: cookie },
		body: JSON.stringify({ json: null }),
	});

	expect(authenticated.status).toBe(200);
	expect(authenticated.headers.get("access-control-allow-origin")).toBe(origin);
	expect(authenticated.headers.get("access-control-allow-credentials")).toBe(
		"true",
	);

	expect(await authenticated.json()).toMatchObject({ json: { id: userId } });

	const forged = await fetch(`${serverOrigin}/api/orpc/me`, {
		method: "POST",
		headers: {
			Origin: origin,
			"Content-Type": "application/json",
			Cookie: cookie,
		},
		body: JSON.stringify({ json: null }),
	});

	expect(forged.status).toBe(403);

	const anonymous = await fetch(`${serverOrigin}/api/orpc/me`, {
		method: "POST",
		headers,
		body: JSON.stringify({ json: null }),
	});

	expect(anonymous.status).toBe(401);
}

async function expectSameOriginOrpcSession(
	projectRoot: string,
	sourceRoot: string,
	origin: string,
	cookie: string,
	userId: string,
) {
	const headers = {
		Origin: origin,
		"Content-Type": "application/json",
		"x-csrf-token": "orpc",
	};

	const authenticated = await fetch(`${origin}/api/orpc/me`, {
		method: "POST",
		headers: { ...headers, Cookie: cookie },
		body: JSON.stringify({ json: null }),
	});

	expect(authenticated.status).toBe(200);
	expect(await authenticated.json()).toEqual({ json: { id: userId } });

	const anonymous = await fetch(`${origin}/api/orpc/me`, {
		method: "POST",
		headers,
		body: JSON.stringify({ json: null }),
	});

	const forged = await fetch(`${origin}/api/orpc/me`, {
		method: "POST",
		headers: {
			Origin: origin,
			"Content-Type": "application/json",
			Cookie: cookie,
		},
		body: JSON.stringify({ json: null }),
	});

	const missing = await fetch(`${origin}/api/orpc/missing`, {
		method: "POST",
		headers,
		body: JSON.stringify({ json: null }),
	});

	expect(anonymous.status).toBe(401);
	expect(forged.status).toBe(403);
	expect(missing.status).toBe(404);

	const caller = await fetch(`${origin}/api/caller-probe`, {
		headers: { Cookie: cookie },
	});

	const anonymousCaller = await fetch(`${origin}/api/caller-probe`);

	expect(caller.status).toBe(200);
	expect(await caller.json()).toEqual({
		health: { status: "ok" },
		me: { id: userId },
	});

	expect(anonymousCaller.status).toBe(401);

	const webRoot = join(projectRoot, "apps/web");

	await writeFile(
		join(webRoot, "orpc-probe.ts"),
		generatedOrpcClientProbe.replace(
			"__CLIENT_IMPORT__",
			`./${sourceRoot}/orpc/client`,
		),
	);

	const result = await build({
		configFile: false,
		root: webRoot,
		logLevel: "error",
		build: {
			minify: false,
			write: false,
			lib: {
				entry: join(webRoot, "orpc-probe.ts"),
				name: "OrpcProbe",
				formats: ["iife"],
			},
		},
	});

	const outputs = Array.isArray(result) ? result : [result];
	const bundle = outputs
		.flatMap((output) => ("output" in output ? output.output : []))
		.find((output) => output.type === "chunk" && output.isEntry);

	if (bundle?.type !== "chunk")
		throw new Error("Missing Browser Client Bundle");

	const probe = (sessionCookie: string) =>
		new Promise<unknown>((resolveResult, rejectResult) => {
			const context = createContext({
				AbortController,
				AbortSignal,
				Blob,
				DOMException,
				File,
				FormData,
				Headers,
				ReadableStream,
				Request,
				Response,
				TextDecoder,
				TextEncoder,
				TransformStream,
				URL,
				URLSearchParams,
				WritableStream,
				atob,
				btoa,
				clearTimeout,
				console,
				crypto,
				location: { origin },
				setTimeout,
				reportResult: resolveResult,
				reportError: rejectResult,
				fetch: (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
					const request = new Request(input, init);

					expect(request.credentials).toBe("include");
					expect(new URL(request.url).origin).toBe(origin);
					request.headers.set("Origin", origin);
					if (sessionCookie) request.headers.set("Cookie", sessionCookie);

					return fetch(request);
				},
			});

			new Script(
				"globalThis.window = globalThis; globalThis.self = globalThis;",
			).runInContext(context);

			new Script(bundle.code).runInContext(context, { timeout: 5000 });
		});

	expect(await probe(cookie)).toEqual({
		health: { status: "ok" },
		me: { value: { id: userId } },
	});

	expect(await probe("")).toEqual({
		health: { status: "ok" },
		me: { status: 401 },
	});
}

async function expectSelfHostedOrpc(projectRoot: string, sourceRoot: string) {
	const reservation = createServer();

	await new Promise<void>((resolveListen, rejectListen) => {
		reservation.once("error", rejectListen);
		reservation.listen(0, "127.0.0.1", resolveListen);
	});

	const address = reservation.address();
	if (address === null || typeof address === "string")
		throw new Error("Missing Reserved Port");

	const port = address.port;

	await new Promise<void>((resolveClose, rejectClose) => {
		reservation.close((error) => (error ? rejectClose(error) : resolveClose()));
	});

	const origin = `http://127.0.0.1:${port}`;
	const generatedEnv = {
		...(await readGeneratedEnv(projectRoot)),
		APP_ORIGIN: origin,
		WEB_URL: origin,
	};

	await expectSchemaPush(projectRoot, generatedEnv);

	const ambientEnv = { ...process.env };

	delete ambientEnv.CI;

	const webRoot = join(projectRoot, "apps/web");
	const server = spawn(
		"node",
		[
			join(webRoot, "node_modules/vite/bin/vite.js"),
			"dev",
			"--host",
			"127.0.0.1",
			"--port",
			String(port),
			"--strictPort",
		],
		{ cwd: webRoot, env: { ...ambientEnv, ...generatedEnv } },
	);

	let output = "";
	const capture = (chunk: Buffer) => {
		output += chunk.toString();
	};

	server.stdout.on("data", capture);
	server.stderr.on("data", capture);

	const exited = new Promise<void>((resolveExit, rejectExit) => {
		server.once("exit", () => resolveExit());
		server.once("error", rejectExit);
	});

	try {
		let ready = false;
		for (let attempt = 0; attempt < 200; attempt += 1) {
			if (server.exitCode !== null) break;

			try {
				const response = await fetch(`${origin}/api/orpc/health`, {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						"x-csrf-token": "orpc",
					},
					body: JSON.stringify({ json: null }),
				});

				if (response.ok) {
					ready = true;
					break;
				}
			} catch {}

			await new Promise((resolveWait) => setTimeout(resolveWait, 100));
		}

		expect(ready, output).toBe(true);

		const signup = await fetch(`${origin}/api/auth/sign-up/email`, {
			method: "POST",
			headers: { Origin: origin, "Content-Type": "application/json" },
			body: JSON.stringify({
				email: "self-orpc@example.com",
				name: "Self Hosted",
				password: "forge-smoke-password",
			}),
		});

		expect(signup.status, `${await signup.text()}\n${output}`).toBe(200);

		const cookie = signup.headers.get("set-cookie")?.split(";", 1)[0];
		if (cookie === undefined)
			throw new Error("Missing Session Cookie: Better Auth sign-up");

		const sessionResponse = await fetch(`${origin}/api/auth/get-session`, {
			headers: { Cookie: cookie },
		});

		const session: unknown = await sessionResponse.json();

		expect(sessionResponse.status).toBe(200);

		if (
			typeof session !== "object" ||
			session === null ||
			!("user" in session) ||
			typeof session.user !== "object" ||
			session.user === null ||
			!("id" in session.user) ||
			typeof session.user.id !== "string"
		)
			throw new Error("Missing Session User: Better Auth sign-up");

		await expectSameOriginOrpcSession(
			projectRoot,
			sourceRoot,
			origin,
			cookie,
			session.user.id,
		);
	} finally {
		if (server.exitCode === null) server.kill("SIGTERM");
		await exited;
	}
}

const generatedOrpcClientProbe = `import { client } from "__CLIENT_IMPORT__";

void (async () => {
  const health = await client.health();
  const me = await client.me().then(
    (value) => ({ value }),
    (error: { status?: number }) => ({ status: error.status }),
  );

  globalThis.reportResult({ health, me });
})().catch(globalThis.reportError);
`;

async function expectGeneratedOrpcClient(
	projectRoot: string,
	generatedEnv: NodeJS.ProcessEnv,
	cookie: string,
	userId: string,
) {
	const webRoot = join(projectRoot, "apps/web");
	const manifest = await readJson<{ framework: string }>(
		join(webRoot, "forge.json"),
	);

	const sourceRoot =
		manifest.framework === "nextjs"
			? ""
			: manifest.framework === "react-router"
				? "app/"
				: "src/";

	await writeFile(
		join(webRoot, "orpc-probe.ts"),
		generatedOrpcClientProbe.replace(
			"__CLIENT_IMPORT__",
			`./${sourceRoot}orpc/client`,
		),
	);

	const result = await build({
		configFile: false,
		root: webRoot,
		logLevel: "error",
		define: {
			"import.meta.env.VITE_SERVER_URL": JSON.stringify(
				generatedEnv.VITE_SERVER_URL,
			),
			...(manifest.framework === "nextjs"
				? {
						"process.env": "{}",
						"process.env.NODE_ENV": '"production"',
						"process.env.NEXT_PUBLIC_SERVER_URL": JSON.stringify(
							generatedEnv.NEXT_PUBLIC_SERVER_URL,
						),
					}
				: {}),
		},
		build: {
			minify: false,
			write: false,
			lib: {
				entry: join(webRoot, "orpc-probe.ts"),
				name: "OrpcProbe",
				formats: ["iife"],
			},
		},
	});

	const outputs = Array.isArray(result) ? result : [result];
	const bundle = outputs
		.flatMap((output) => ("output" in output ? output.output : []))
		.find((output) => output.type === "chunk" && output.isEntry);

	if (bundle?.type !== "chunk")
		throw new Error("Missing Browser Client Bundle");

	const probe = (sessionCookie: string) =>
		new Promise<unknown>((resolveResult, rejectResult) => {
			const context = createContext({
				AbortController,
				AbortSignal,
				Blob,
				DOMException,
				File,
				FormData,
				Headers,
				ReadableStream,
				Request,
				Response,
				TextDecoder,
				TextEncoder,
				TransformStream,
				URL,
				URLSearchParams,
				WritableStream,
				atob,
				btoa,
				clearTimeout,
				console,
				crypto,
				setTimeout,
				reportResult: resolveResult,
				reportError: rejectResult,
				fetch: async (
					input: Parameters<typeof fetch>[0],
					init?: RequestInit,
				) => {
					const request = new Request(input, init);
					expect(request.credentials).toBe("include");
					request.headers.set("Origin", generatedEnv.WEB_URL ?? "");
					if (sessionCookie) request.headers.set("Cookie", sessionCookie);

					const response = await fetch(request);
					expect(response.headers.get("access-control-allow-origin")).toBe(
						generatedEnv.WEB_URL,
					);

					expect(response.headers.get("access-control-allow-credentials")).toBe(
						"true",
					);

					return response;
				},
			});

			new Script(
				"globalThis.window = globalThis; globalThis.self = globalThis;",
			).runInContext(context);

			new Script(bundle.code).runInContext(context, { timeout: 5000 });
		});

	expect(await probe(cookie)).toEqual({
		health: { status: "ok" },
		me: { value: { id: userId } },
	});

	expect(await probe("")).toEqual({
		health: { status: "ok" },
		me: { status: 401 },
	});
}

async function expectDrainingWorker(projectRoot: string) {
	const generatedEnv = await readGeneratedEnv(projectRoot);
	const secret = generatedEnv.WORKER_SECRET;
	if (secret === undefined)
		throw new Error(`Missing Worker Secret: ${projectRoot}`);

	const ambientEnv = { ...process.env };
	delete ambientEnv.CI;

	const worker = spawn("node", ["dist/index.js"], {
		cwd: join(projectRoot, "apps/worker"),
		env: { ...ambientEnv, ...generatedEnv },
	});

	let output = "";
	const capture = (chunk: Buffer) => {
		output += chunk.toString();
	};

	worker.stdout.on("data", capture);
	worker.stderr.on("data", capture);
	const exited = new Promise<number | null>((resolveExit) => {
		worker.once("exit", (code) => resolveExit(code));
	});

	const origin = "http://localhost:8080";
	try {
		let ready = false;
		for (let attempt = 0; attempt < 50; attempt += 1) {
			try {
				const response = await fetch(`${origin}/health`);
				if (response.ok) {
					ready = true;
					break;
				}
			} catch {}

			await new Promise((resolveWait) => setTimeout(resolveWait, 100));
		}

		expect(ready, output).toBe(true);

		const unauthorized = await fetch(`${origin}/run`, { method: "POST" });
		expect(unauthorized.status).toBe(401);

		const triggered = await fetch(`${origin}/run`, {
			headers: { Authorization: `Bearer ${secret}` },
			method: "POST",
		});

		expect(triggered.status, output).toBe(200);
		expect(await triggered.json()).toEqual({ ok: true });

		const idle = await fetch(`${origin}/health`);
		expect(idle.status, output).toBe(200);
		expect(await idle.json()).toMatchObject({ inFlight: 0, ok: true });
	} finally {
		if (worker.exitCode === null) worker.kill("SIGTERM");
	}

	expect(await exited, output).toBe(0);
}

async function expectBundledNativeWindStyles(workspace: ScenarioProject) {
	const mobileRoot = join(workspace.projectRoot, "apps/mobile");
	const outputDir = join(mobileRoot, "dist-export");

	const exported = await runCommand(
		"pnpm",
		[
			"exec",
			"expo",
			"export",
			"--platform",
			"ios",
			"--no-bytecode",
			"--output-dir",
			outputDir,
		],
		{ cwd: mobileRoot, env: forgeEnvironment(workspace.workspaceRoot) },
	);

	expect(
		exported.exitCode,
		`expo export failed with code ${exported.exitCode}\n${exported.stdout}\n${exported.stderr}`,
	).toBe(0);

	const bundleRoot = join(outputDir, "_expo", "static", "js", "ios");
	const bundleName = (await readdir(bundleRoot)).find((entry) =>
		entry.endsWith(".js"),
	);

	if (bundleName === undefined)
		throw new Error(`Missing Exported Bundle: ${bundleRoot}`);

	const bundle = await readFile(join(bundleRoot, bundleName), "utf-8");
	const stylesheet = /StyleCollection\.inject\([\s\S]{0,4000}/.exec(
		bundle,
	)?.[0];

	if (stylesheet === undefined)
		throw new Error(`Missing Compiled Stylesheet: ${bundleName}`);

	for (const utility of [
		"flex-1",
		"items-center",
		"justify-center",
		"text-2xl",
	])
		expect(stylesheet, utility).toContain(utility);
}

describe.runIf(process.env.FORGE_SMOKE === "1")("install smoke", () => {
	it.each([
		{ backend: "hono", web: "nextjs", emailProvider: "resend" },
		{ backend: "fastify", web: "tanstack-router", emailProvider: "postmark" },
		{ backend: "express", web: "tanstack-router", emailProvider: "smtp" },
	])(
		"installs and authenticates email methods on $backend with $emailProvider",
		async ({ backend, web, emailProvider }) => {
			await withScenarioWorkspace(
				`smoke-email-auth-${backend}`,
				async (workspace) => {
					await createProject(workspace, {
						authentication: "better-auth",
						authMethods: ["email-password", "email-otp", "magic-link"],
						backend,
						database: "sqlite",
						emailProvider,
						linter: "biome",
						orm: "drizzle",
						packageManager: "pnpm",
						rpc: "trpc",
						style: "tailwind",
						web,
					});

					await writeFile(
						join(workspace.projectRoot, "packages/auth/src/email-probe.ts"),
						[
							'import { authClient } from "./client";',
							"export const sendOtp = authClient.emailOtp.sendVerificationOtp;",
							"export const signInOtp = authClient.signIn.emailOtp;",
							"export const signInMagic = authClient.signIn.magicLink;",
							"",
						].join("\n"),
					);

					await expectInstallBuildAndTypecheck(workspace, "pnpm");

					const declarations = await runCommand(
						"pnpm",
						[
							"exec",
							"tsc",
							"--emitDeclarationOnly",
							"--outDir",
							join(workspace.workspaceRoot, "auth-declarations"),
						],
						{ cwd: join(workspace.projectRoot, "packages/auth") },
					);

					expect(
						declarations.exitCode,
						`${declarations.stdout}\n${declarations.stderr}`,
					).toBe(0);

					await expectCredentialedGeneratedServer(workspace.projectRoot, {
						emailAuth: true,
					});
				},
			);
		},
		600_000,
	);

	it.each([
		{ primary: "tanstack-router", secondary: "nextjs", backend: "hono" },
		{ primary: "nextjs", secondary: "tanstack-router", backend: "hono" },
		{ primary: "react-router", secondary: "tanstack-start" },
		{ primary: "tanstack-start", secondary: "react-router" },
	])(
		"installs, builds, and typechecks $primary with a $secondary secondary app",
		async ({ primary, secondary, backend }) => {
			await withScenarioWorkspace(
				`smoke-secondary-${primary}-${secondary}`,
				async (workspace) => {
					await createProject(workspace, {
						web: primary,
						backend,
						rpc: "trpc",
						authentication: "better-auth",
						orm: "drizzle",
						database: "sqlite",
						style: "tailwind",
						linter: "biome",
						packageManager: "pnpm",
						webApps: [{ name: "admin", framework: secondary }],
					});

					await expectInstallBuildAndTypecheck(workspace, "pnpm");
				},
			);
		},
		600_000,
	);

	it("installs, builds, and typechecks secondary web apps with a Hono host", async () => {
		await withScenarioWorkspace(
			"smoke-secondary-web-app",
			async (workspace) => {
				await createProject(workspace, {
					web: "tanstack-router",
					backend: "hono",
					rpc: "trpc",
					authentication: "better-auth",
					orm: "drizzle",
					database: "sqlite",
					style: "tailwind",
					linter: "biome",
					packageManager: "pnpm",
					webApps: [{ name: "admin", framework: "tanstack-router" }],
				});

				await expectInstallBuildAndTypecheck(workspace, "pnpm");
			},
		);
	}, 600_000);

	it.each(["trpc", "orpc"] as const)(
		"installs secondary %s clients and accepts their credentialed requests",
		async (rpc) => {
			await withScenarioWorkspace(
				`smoke-secondary-client-${rpc}`,
				async (workspace) => {
					await createProject(workspace, {
						authentication: "better-auth",
						authMethods: ["email-password", "passkey"],
						backend: "hono",
						database: "sqlite",
						orm: "drizzle",
						packageManager: "pnpm",
						rpc,
						web: "tanstack-router",
						webApps: [{ name: "admin", framework: "nextjs", client: true }],
						style: "tailwind",
					});

					await expectInstallBuildAndTypecheck(workspace, "pnpm");
					await expectCredentialedGeneratedServer(workspace.projectRoot, {
						rpc,
						clientOrigin: "http://localhost:3002",
						passkey: true,
					});
				},
			);
		},
		600_000,
	);

	it("installs self-hosted RPC and auth with a secondary client", async () => {
		await withScenarioWorkspace(
			"smoke-secondary-client-self",
			async (workspace) => {
				await createProject(workspace, {
					authentication: "better-auth",
					authMethods: ["email-password", "passkey"],
					backend: "self",
					database: "sqlite",
					orm: "drizzle",
					packageManager: "pnpm",
					rpc: "trpc",
					web: "nextjs",
					webApps: [{ name: "admin", framework: "nextjs", client: true }],
					style: "tailwind",
				});

				await expectInstallBuildAndTypecheck(workspace, "pnpm");
				await expectCredentialedGeneratedServer(workspace.projectRoot, {
					clientOrigin: "http://localhost:3002",
					host: "nextjs",
				});
			},
		);
	}, 600_000);

	it.each(["tanstack-router", "react-router"])(
		"installs, builds, and typechecks %s with an oRPC Hono host",
		async (web) => {
			await withScenarioWorkspace(
				`smoke-orpc-hono-${web}`,
				async (workspace) => {
					await createProject(workspace, {
						authentication: "better-auth",
						backend: "hono",
						database: "sqlite",
						linter: "biome",
						orm: "drizzle",
						packageManager: "pnpm",
						rpc: "orpc",
						style: "tailwind",
						web,
					});

					await expectInstallBuildAndTypecheck(workspace, "pnpm");
					await expectCredentialedGeneratedServer(workspace.projectRoot, {
						rpc: "orpc",
						webOrigin:
							web === "react-router"
								? "http://localhost:5173"
								: "http://localhost:3000",
					});
				},
			);
		},
		600_000,
	);

	it.each([
		{ web: "tanstack-start", sourceRoot: "src" },
		{ web: "react-router", sourceRoot: "app" },
	])(
		"installs, builds, and typechecks $web as an oRPC self host",
		async ({ web, sourceRoot }) => {
			await withScenarioWorkspace(
				`smoke-orpc-self-${web}`,
				async (workspace) => {
					await createProject(workspace, {
						authentication: "better-auth",
						authMethods: ["email-password"],
						backend: "self",
						database: "sqlite",
						orm: "drizzle",
						packageManager: "pnpm",
						rpc: "orpc",
						style: "tailwind",
						web,
					});

					const callerProbe =
						web === "tanstack-start"
							? `import "@tanstack/react-start";
import { ORPCError } from "@orpc/server";
import { createFileRoute } from "@tanstack/react-router";
import { client } from "../../orpc/client";
import { createServerCaller } from "../../orpc/server";

export const Route = createFileRoute("/api/caller-probe")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (typeof client.health !== "function") throw new Error("Missing Browser Client");

        const caller = await createServerCaller(request);

        try {
          return Response.json({ health: await caller.health(), me: await caller.me() });
        } catch (error) {
          if (error instanceof ORPCError) return Response.json({ code: error.code }, { status: error.status });

          throw error;
        }
      },
    },
  },
});
`
							: `import { ORPCError } from "@orpc/server";
import { client } from "../orpc/client";
import { createServerCaller } from "../orpc/server";

export async function loader({ request }: { request: Request }) {
  if (typeof client.health !== "function") throw new Error("Missing Browser Client");

  const caller = await createServerCaller(request);

  try {
    return Response.json({ health: await caller.health(), me: await caller.me() });
  } catch (error) {
    if (error instanceof ORPCError) return Response.json({ code: error.code }, { status: error.status });

    throw error;
  }
}
`;

					await writeFile(
						join(
							workspace.projectRoot,
							`apps/web/${sourceRoot}/routes/${web === "tanstack-start" ? "api/caller-probe.ts" : "api.caller-probe.ts"}`,
						),
						callerProbe,
					);

					if (web === "react-router") {
						const routesPath = join(
							workspace.projectRoot,
							"apps/web/app/routes.ts",
						);

						const routes = await readFile(routesPath, "utf8");

						await writeFile(
							routesPath,
							routes.replace(
								"export default [",
								'export default [\n  route("api/caller-probe", "routes/api.caller-probe.ts"),',
							),
						);
					}

					await expectInstallBuildAndTypecheck(workspace, "pnpm");
					await expectSelfHostedOrpc(workspace.projectRoot, sourceRoot);
				},
			);
		},
		600_000,
	);

	it.each(["nextjs", "tanstack-start"])(
		"installs, builds, and typechecks %s as an oRPC Hono client",
		async (web) => {
			await withScenarioWorkspace(
				`smoke-orpc-hono-${web}`,
				async (workspace) => {
					await createProject(workspace, {
						authentication: "better-auth",
						backend: "hono",
						database: "sqlite",
						orm: "drizzle",
						packageManager: "pnpm",
						rpc: "orpc",
						style: "tailwind",
						web,
					});

					await expectInstallBuildAndTypecheck(workspace, "pnpm");
					await expectCredentialedGeneratedServer(workspace.projectRoot, {
						rpc: "orpc",
					});
				},
			);
		},
		600_000,
	);

	it("installs, builds, and typechecks Next.js with a Hono API host", async () => {
		await withScenarioWorkspace("smoke-hono-nextjs", async (workspace) => {
			await createProject(workspace, {
				authentication: "better-auth",
				authMethods: ["email-password", "google", "apple", "passkey"],
				authPlugins: ["username", "admin", "polar"],
				backend: "hono",
				database: "sqlite",
				emailProvider: "smtp",
				linter: "biome",
				orm: "drizzle",
				packageManager: "pnpm",
				rpc: "trpc",
				style: "tailwind",
				web: "nextjs",
			});

			await expectInstallBuildAndTypecheck(workspace, "pnpm");
			await expectCredentialedGeneratedServer(workspace.projectRoot, {
				passkey: true,
				polar: true,
				username: "hono_smoke",
			});
		});
	}, 600_000);

	it("installs, builds, and typechecks TanStack Router with Hono", async () => {
		await withScenarioWorkspace("smoke-hono-spa", async (workspace) => {
			await createProject(workspace, {
				authentication: "better-auth",
				backend: "hono",
				database: "postgresql",
				emailProvider: "resend",
				linter: "biome",
				orm: "drizzle",
				packageManager: "pnpm",
				rpc: "trpc",
				style: "tailwind",
				web: "tanstack-router",
			});

			await expectInstallBuildAndTypecheck(workspace, "pnpm");
		});
	}, 600_000);

	it("installs, builds, and typechecks Next.js with a Fastify API host", async () => {
		await withScenarioWorkspace("smoke-fastify-nextjs", async (workspace) => {
			await createProject(workspace, {
				authentication: "better-auth",
				authPlugins: ["polar"],
				backend: "fastify",
				database: "sqlite",
				emailProvider: "postmark",
				linter: "biome",
				orm: "drizzle",
				packageManager: "pnpm",
				rpc: "trpc",
				style: "tailwind",
				web: "nextjs",
			});

			await expectInstallBuildAndTypecheck(workspace, "pnpm");
			await expectCredentialedGeneratedServer(workspace.projectRoot, {
				polar: true,
			});
		});
	}, 600_000);

	it("installs, builds, and typechecks TanStack Router with Fastify", async () => {
		await withScenarioWorkspace("smoke-fastify-spa", async (workspace) => {
			await createProject(workspace, {
				authentication: "better-auth",
				backend: "fastify",
				database: "sqlite",
				linter: "biome",
				orm: "drizzle",
				packageManager: "pnpm",
				rpc: "trpc",
				style: "tailwind",
				web: "tanstack-router",
			});

			await expectInstallBuildAndTypecheck(workspace, "pnpm");
			await expectCredentialedGeneratedServer(workspace.projectRoot);
		});
	}, 600_000);

	it("installs, builds, and typechecks Next.js with an Express API host", async () => {
		await withScenarioWorkspace("smoke-express-nextjs", async (workspace) => {
			await createProject(workspace, {
				authentication: "better-auth",
				authPlugins: ["polar"],
				backend: "express",
				database: "sqlite",
				linter: "biome",
				orm: "drizzle",
				packageManager: "pnpm",
				rpc: "trpc",
				style: "tailwind",
				web: "nextjs",
			});

			await expectInstallBuildAndTypecheck(workspace, "pnpm");
			await expectCredentialedGeneratedServer(workspace.projectRoot, {
				polar: true,
			});
		});
	}, 600_000);

	it("installs, builds, and typechecks TanStack Router with Express", async () => {
		await withScenarioWorkspace("smoke-express-spa", async (workspace) => {
			await createProject(workspace, {
				authentication: "better-auth",
				backend: "express",
				database: "sqlite",
				linter: "biome",
				orm: "drizzle",
				packageManager: "pnpm",
				rpc: "trpc",
				style: "tailwind",
				web: "tanstack-router",
			});

			await expectInstallBuildAndTypecheck(workspace, "pnpm");
			await expectCredentialedGeneratedServer(workspace.projectRoot);
		});
	}, 600_000);

	it("installs a prisma project, generates the client, typechecks, and pushes", async () => {
		await withScenarioWorkspace("smoke-prisma", async (workspace) => {
			await createProject(
				workspace,
				{
					...authPluginConfig,
					authentication: "better-auth",
					database: "postgresql",
					linter: "biome",
					orm: "prisma",
					packageManager: "pnpm",
					style: "tailwind",
					web: "nextjs",
				},
				{ install: true },
			);

			expect(
				await pathExists(
					join(workspace.projectRoot, "packages/db/src/generated/prisma"),
				),
			).toBe(true);

			await expectPasskeyInstallAndTypecheck(workspace);
			await expectSchemaPush(
				workspace.projectRoot,
				postgresDatabaseEnv("forge_smoke_prisma"),
			);
		});
	}, 600_000);

	it("installs, typechecks, and pushes a drizzle project with trpc and tailwind", async () => {
		await withScenarioWorkspace("smoke-drizzle", async (workspace) => {
			await createProject(
				workspace,
				{
					...authPluginConfig,
					authentication: "better-auth",
					database: "postgresql",
					linter: "biome",
					orm: "drizzle",
					packageManager: "pnpm",
					rpc: "trpc",
					style: "tailwind",
					web: "nextjs",
				},
				{ install: true },
			);

			await expectPasskeyInstallAndTypecheck(workspace);
			await createSmokeDatabase(
				workspace.projectRoot,
				"postgresql",
				"forge_smoke_drizzle",
			);

			await expectSchemaPush(
				workspace.projectRoot,
				postgresDatabaseEnv("forge_smoke_drizzle"),
			);
		});
	}, 600_000);

	it("installs, typechecks, and pushes a drizzle mysql project", async () => {
		await withScenarioWorkspace("smoke-drizzle-mysql", async (workspace) => {
			await createProject(
				workspace,
				{
					...authPluginConfig,
					authentication: "better-auth",
					database: "mysql",
					linter: "biome",
					orm: "drizzle",
					packageManager: "pnpm",
					rpc: "trpc",
					style: "tailwind",
					web: "nextjs",
				},
				{ install: true },
			);

			await expectPasskeyInstallAndTypecheck(workspace);
			await createSmokeDatabase(
				workspace.projectRoot,
				"mysql",
				"forge_smoke_drizzle_mysql",
			);

			await expectSchemaPush(
				workspace.projectRoot,
				mysqlDatabaseEnv("forge_smoke_drizzle_mysql"),
			);
		});
	}, 600_000);

	it("installs, typechecks, and pushes a drizzle planetscale mysql project", async () => {
		await withScenarioWorkspace(
			"smoke-drizzle-planetscale-mysql",
			async (workspace) => {
				await createProject(
					workspace,
					{
						...authPluginConfig,
						authentication: "better-auth",
						database: "mysql",
						databaseProvider: "planetscale",
						linter: "biome",
						orm: "drizzle",
						packageManager: "pnpm",
						style: "tailwind",
						web: "nextjs",
					},
					{ install: true },
				);

				await expectPasskeyInstallAndTypecheck(workspace);
				await createSmokeDatabase(
					workspace.projectRoot,
					"mysql",
					"forge_smoke_drizzle_planetscale",
				);

				await expectSchemaPush(
					workspace.projectRoot,
					mysqlDatabaseEnv("forge_smoke_drizzle_planetscale"),
				);
			},
		);
	}, 600_000);

	it("installs, typechecks, and pushes a prisma mysql project", async () => {
		await withScenarioWorkspace("smoke-prisma-mysql", async (workspace) => {
			await createProject(
				workspace,
				{
					...authPluginConfig,
					authentication: "better-auth",
					database: "mysql",
					linter: "biome",
					orm: "prisma",
					packageManager: "pnpm",
					style: "tailwind",
					web: "nextjs",
				},
				{ install: true },
			);

			await expectPasskeyInstallAndTypecheck(workspace);
			await expectSchemaPush(
				workspace.projectRoot,
				mysqlDatabaseEnv("forge_smoke_prisma_mysql"),
			);
		});
	}, 600_000);

	it("installs, typechecks, and pushes a prisma sqlite project", async () => {
		await withScenarioWorkspace("smoke-prisma-sqlite", async (workspace) => {
			await createProject(
				workspace,
				{
					...authPluginConfig,
					authentication: "better-auth",
					database: "sqlite",
					linter: "biome",
					orm: "prisma",
					packageManager: "pnpm",
					style: "tailwind",
					web: "nextjs",
				},
				{ install: true },
			);

			await expectPasskeyInstallAndTypecheck(workspace);
			await expectSchemaPush(workspace.projectRoot);
		});
	}, 600_000);

	it("installs, typechecks, and pushes a drizzle sqlite project", async () => {
		await withScenarioWorkspace("smoke-drizzle-sqlite", async (workspace) => {
			await createProject(
				workspace,
				{
					...authPluginConfig,
					authentication: "better-auth",
					database: "sqlite",
					linter: "biome",
					orm: "drizzle",
					packageManager: "pnpm",
					rpc: "trpc",
					style: "tailwind",
					web: "nextjs",
				},
				{ install: true },
			);

			await expectPasskeyInstallAndTypecheck(workspace);
			await expectSchemaPush(workspace.projectRoot);
		});
	}, 600_000);

	it("installs, typechecks, and pushes a prisma planetscale mysql passkey project", async () => {
		await withScenarioWorkspace(
			"smoke-prisma-planetscale-passkey",
			async (workspace) => {
				await createProject(
					workspace,
					{
						...authPluginConfig,
						authentication: "better-auth",
						database: "mysql",
						databaseProvider: "planetscale",
						linter: "biome",
						orm: "prisma",
						packageManager: "pnpm",
						web: "nextjs",
					},
					{ install: true },
				);

				await expectPasskeyInstallAndTypecheck(workspace);
				await expectSchemaPush(
					workspace.projectRoot,
					mysqlDatabaseEnv("forge_smoke_prisma_mysql"),
				);
			},
		);
	}, 600_000);

	for (const cell of postgresProviderCells) {
		const transactionTitle = {
			supported: "runs a transaction probe",
			unsupported: "confirms the known transaction limitation",
		}[cell.transaction];

		it(`installs, typechecks, and ${transactionTitle} on drizzle with ${cell.provider} postgres`, async () => {
			await withScenarioWorkspace(
				`smoke-drizzle-${cell.provider}`,
				async (workspace) => {
					const url = smokeDatabaseUrl();

					await createProject(
						workspace,
						{
							authentication: "better-auth",
							database: "postgresql",
							databaseProvider: cell.provider,
							linter: "biome",
							orm: "drizzle",
							packageManager: "pnpm",
							rpc: "trpc",
							style: "tailwind",
							web: "nextjs",
						},
						{ install: true },
					);

					await writeFile(
						join(workspace.projectRoot, "packages/db/src/transaction-probe.ts"),
						transactionProbeSource,
					);

					await expectInstallAndTypecheck(workspace, "pnpm");

					const probe = await runTransactionProbe(workspace, url);
					switch (cell.transaction) {
						case "supported":
							expect(probe.exitCode, `${probe.stdout}\n${probe.stderr}`).toBe(
								0,
							);

							break;

						case "unsupported":
							expect(probe.exitCode, probe.stderr).not.toBe(0);
							expect(probe.stderr).toContain(
								"No transactions support in neon-http driver",
							);

							break;
					}
				},
			);
		}, 600_000);
	}

	// Each framework addition gets one pnpm-only acceptance case; the
	// package-manager matrix remains Next.js-only to keep smoke cost bounded.
	it("installs, builds, and typechecks an Expo project", async () => {
		await withScenarioWorkspace("smoke-expo", async (workspace) => {
			await createProject(workspace, {
				authentication: "better-auth",
				authPlugins: ["polar"],
				backend: "hono",
				database: "sqlite",
				mobile: "expo",
				nativeStyleFramework: "nativewind",
				orm: "drizzle",
				packageManager: "pnpm",
				platforms: ["web", "mobile"],
				rpc: "trpc",
				style: "tailwind",
				web: "nextjs",
			});

			await expectInstallBuildAndTypecheck(workspace, "pnpm");
			expect(
				await pathExists(join(workspace.projectRoot, "apps/mobile/forge.json")),
			).toBe(true);

			await expectBundledNativeWindStyles(workspace);
		});
	}, 600_000);

	it("installs, builds, and typechecks a full TanStack Start project", async () => {
		await withScenarioWorkspace("smoke-tanstack-start", async (workspace) => {
			await createProject(workspace, {
				authentication: "better-auth",
				database: "postgresql",
				linter: "biome",
				orm: "drizzle",
				packageManager: "pnpm",
				rpc: "trpc",
				style: "tailwind",
				web: "tanstack-start",
			});

			await expectInstallBuildAndTypecheck(workspace, "pnpm");
		});
	}, 600_000);

	it("installs, builds, and typechecks a TanStack Router SPA with a worker", async () => {
		await withScenarioWorkspace("smoke-tanstack-router", async (workspace) => {
			await createProject(workspace, {
				addons: ["worker"],
				linter: "biome",
				packageManager: "pnpm",
				style: "tailwind",
				web: "tanstack-router",
			});

			await expectInstallBuildAndTypecheck(workspace, "pnpm");
			await expectDrainingWorker(workspace.projectRoot);
		});
	}, 600_000);

	it("installs, builds, and typechecks a full React Router project", async () => {
		await withScenarioWorkspace("smoke-react-router", async (workspace) => {
			await createProject(workspace, {
				authentication: "better-auth",
				database: "postgresql",
				linter: "biome",
				orm: "drizzle",
				packageManager: "pnpm",
				rpc: "trpc",
				style: "tailwind",
				web: "react-router",
			});

			await expectInstallBuildAndTypecheck(workspace, "pnpm");
		});
	}, 600_000);
});
